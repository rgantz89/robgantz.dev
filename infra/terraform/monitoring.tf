# Uptime and SLO monitoring.
# A Lambda checks the site every 5 minutes, emits CloudWatch metrics, keeps daily
# aggregates in DynamoDB, and publishes /status/status.json for the public status page.

locals {
  uptime_name = "robgantz-uptime-check"
  metric_ns   = "RobGantz/Uptime"
  status_key  = "status/status.json"
}

# --- Check history: one item per day, expires after 40 days -------------------

resource "aws_dynamodb_table" "uptime" {
  name         = "robgantz-uptime"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "expires"
    enabled        = true
  }

  tags = local.tags
}

# --- Checker function ---------------------------------------------------------

data "archive_file" "uptime" {
  type             = "zip"
  source_file      = "${path.module}/lambda/uptime_check.py"
  output_path      = "${path.module}/.build/uptime_check.zip"
  output_file_mode = "0666"
}

resource "aws_cloudwatch_log_group" "uptime" {
  name              = "/aws/lambda/${local.uptime_name}"
  retention_in_days = 14
  tags              = local.tags
}

resource "aws_iam_role" "uptime" {
  name = local.uptime_name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "uptime" {
  name = "uptime-check"
  role = aws_iam_role.uptime.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteOwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.uptime.arn}:*"
      },
      {
        Sid      = "RecordHistory"
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem", "dynamodb:Query"]
        Resource = aws_dynamodb_table.uptime.arn
      },
      {
        Sid      = "PublishStatusFile"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.site.arn}/${local.status_key}"
      },
    ]
  })
}

resource "aws_lambda_function" "uptime" {
  function_name    = local.uptime_name
  description      = "Checks ${var.site_domain} every 5 minutes and publishes the status page data"
  role             = aws_iam_role.uptime.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "uptime_check.handler"
  filename         = data.archive_file.uptime.output_path
  source_code_hash = data.archive_file.uptime.output_base64sha256
  memory_size      = 128
  timeout          = 30

  environment {
    variables = {
      SITE_DOMAIN   = var.site_domain
      CHECK_PATHS   = "/,/change-governance.html,/ops-dashboards-aws.html"
      TABLE_NAME    = aws_dynamodb_table.uptime.name
      STATUS_BUCKET = aws_s3_bucket.site.id
      STATUS_KEY    = local.status_key
      SLO_TARGET    = tostring(var.slo_target)
      INTERVAL_MIN  = "5"
      METRIC_NS     = local.metric_ns
    }
  }

  depends_on = [aws_cloudwatch_log_group.uptime, aws_iam_role_policy.uptime]
  tags       = local.tags
}

resource "aws_cloudwatch_event_rule" "uptime" {
  name                = local.uptime_name
  description         = "Run the uptime check every 5 minutes"
  schedule_expression = "rate(5 minutes)"
  tags                = local.tags
}

resource "aws_cloudwatch_event_target" "uptime" {
  rule = aws_cloudwatch_event_rule.uptime.name
  arn  = aws_lambda_function.uptime.arn
}

resource "aws_lambda_permission" "uptime" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.uptime.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.uptime.arn
}

# --- Alerting -----------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "robgantz-alerts"
  tags = local.tags
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  alarms = {
    site-down = {
      description = "Site failed health checks for 10 minutes"
      metric      = "Availability"
      statistic   = "Minimum"
      period      = 300
      evaluations = 2
      threshold   = 1
      missing     = "notBreaching"
    }
    checker-stale = {
      description = "No health check results for 15 minutes: the checker itself may be down"
      metric      = "Availability"
      statistic   = "SampleCount"
      period      = 300
      evaluations = 3
      threshold   = 1
      missing     = "breaching"
    }
    security-headers = {
      description = "CSP or HSTS missing from responses for 10 minutes"
      metric      = "HeadersOK"
      statistic   = "Minimum"
      period      = 300
      evaluations = 2
      threshold   = 1
      missing     = "notBreaching"
    }
    cert-expiring = {
      description = "TLS certificate expires in under 21 days"
      metric      = "CertDaysLeft"
      statistic   = "Minimum"
      period      = 3600
      evaluations = 1
      threshold   = 21
      missing     = "notBreaching"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "site" {
  for_each = local.alarms

  alarm_name          = "robgantz-${each.key}"
  alarm_description   = each.value.description
  namespace           = local.metric_ns
  metric_name         = each.value.metric
  dimensions          = { Site = var.site_domain }
  statistic           = each.value.statistic
  period              = each.value.period
  evaluation_periods  = each.value.evaluations
  datapoints_to_alarm = each.value.evaluations
  threshold           = each.value.threshold
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = each.value.missing
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

# --- Cost guardrail -----------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  name         = "robgantz-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
