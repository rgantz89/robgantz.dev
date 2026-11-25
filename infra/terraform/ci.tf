# Roles for the Terraform pipeline.
# Pull requests get a read-only role that can only plan.
# Apply runs on main through the "production" GitHub environment, which requires approval.

variable "tf_state_bucket" {
  description = "S3 bucket holding Terraform state. Passed in, not committed."
  type        = string
}

resource "aws_iam_role" "tf_plan" {
  name                 = "github-terraform-plan-robgantz-dev"
  description          = "Terraform plan from pull requests (read-only)"
  assume_role_policy   = data.aws_iam_policy_document.gh_trust["pr"].json
  max_session_duration = 3600
  tags                 = local.tags
}

resource "aws_iam_role_policy_attachment" "tf_plan_readonly" {
  role       = aws_iam_role.tf_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role" "tf_apply" {
  name                 = "github-terraform-apply-robgantz-dev"
  description          = "Terraform apply from main via the approved production environment"
  assume_role_policy   = data.aws_iam_policy_document.gh_trust["environment"].json
  max_session_duration = 3600
  tags                 = local.tags
}

resource "aws_iam_role_policy_attachment" "tf_apply_readonly" {
  role       = aws_iam_role.tf_apply.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

locals {
  state_bucket_arn = "arn:aws:s3:::${var.tf_state_bucket}"
}

# Both roles need the state lock file; plan never writes state itself.
resource "aws_iam_role_policy" "tf_state" {
  for_each = { plan = aws_iam_role.tf_plan.name, apply = aws_iam_role.tf_apply.name }

  name = "terraform-state"
  role = each.value
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListState"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = local.state_bucket_arn
      },
      {
        Sid      = "StateLock"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${local.state_bucket_arn}/*.tflock"
      },
      {
        Sid      = each.key == "apply" ? "WriteState" : "ReadState"
        Effect   = "Allow"
        Action   = each.key == "apply" ? ["s3:GetObject", "s3:PutObject"] : ["s3:GetObject"]
        Resource = "${local.state_bucket_arn}/*.tfstate"
      },
    ]
  })
}

# Apply can change only this project's resources, scoped by name or ARN.
resource "aws_iam_role_policy" "tf_apply" {
  name = "terraform-apply"
  role = aws_iam_role.tf_apply.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SiteBucketConfig"
        Effect = "Allow"
        Action = [
          "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutBucketPublicAccessBlock",
          "s3:PutEncryptionConfiguration", "s3:PutBucketOwnershipControls",
          "s3:PutBucketVersioning", "s3:PutLifecycleConfiguration", "s3:PutBucketTagging",
        ]
        Resource = aws_s3_bucket.site.arn
      },
      {
        Sid    = "CloudFront"
        Effect = "Allow"
        Action = [
          "cloudfront:UpdateDistribution", "cloudfront:TagResource", "cloudfront:UntagResource",
          "cloudfront:CreateFunction", "cloudfront:UpdateFunction", "cloudfront:PublishFunction",
          "cloudfront:UpdateResponseHeadersPolicy", "cloudfront:UpdateOriginAccessControl",
        ]
        Resource = "arn:aws:cloudfront::${local.account_id}:*"
      },
      {
        Sid      = "Dns"
        Effect   = "Allow"
        Action   = ["route53:ChangeResourceRecordSets", "route53:ChangeTagsForResource", "route53:UpdateHostedZoneComment"]
        Resource = aws_route53_zone.main.arn
      },
      {
        Sid      = "DnsChangeStatus"
        Effect   = "Allow"
        Action   = "route53:GetChange"
        Resource = "arn:aws:route53:::change/*"
      },
      {
        Sid      = "Certificate"
        Effect   = "Allow"
        Action   = ["acm:AddTagsToCertificate", "acm:RemoveTagsFromCertificate", "acm:UpdateCertificateOptions"]
        Resource = aws_acm_certificate.site.arn
      },
      {
        Sid    = "ProjectRoles"
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:DeleteRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy",
          "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
          "iam:TagRole", "iam:UntagRole",
        ]
        Resource = [
          "arn:aws:iam::${local.account_id}:role/robgantz-*",
          "arn:aws:iam::${local.account_id}:role/github-*-robgantz-dev",
        ]
      },
      {
        Sid      = "PassRoleToLambdaOnly"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:aws:iam::${local.account_id}:role/robgantz-*"
        Condition = {
          StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" }
        }
      },
      {
        Sid      = "OidcProvider"
        Effect   = "Allow"
        Action   = ["iam:UpdateOpenIDConnectProviderThumbprint", "iam:TagOpenIDConnectProvider", "iam:UntagOpenIDConnectProvider"]
        Resource = aws_iam_openid_connect_provider.github.arn
      },
      {
        Sid    = "Lambda"
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction", "lambda:DeleteFunction", "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration", "lambda:AddPermission", "lambda:RemovePermission",
          "lambda:TagResource", "lambda:UntagResource", "lambda:PublishVersion",
        ]
        Resource = "arn:aws:lambda:us-east-1:${local.account_id}:function:robgantz-*"
      },
      {
        Sid    = "DynamoDb"
        Effect = "Allow"
        Action = [
          "dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:UpdateTable",
          "dynamodb:UpdateTimeToLive", "dynamodb:TagResource", "dynamodb:UntagResource",
        ]
        Resource = "arn:aws:dynamodb:us-east-1:${local.account_id}:table/robgantz-*"
      },
      {
        Sid      = "Schedule"
        Effect   = "Allow"
        Action   = ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets", "events:TagResource", "events:UntagResource"]
        Resource = "arn:aws:events:us-east-1:${local.account_id}:rule/robgantz-*"
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:TagResource", "logs:UntagResource", "logs:TagLogGroup"]
        Resource = "arn:aws:logs:us-east-1:${local.account_id}:log-group:/aws/lambda/robgantz-*"
      },
      {
        Sid      = "Alarms"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:TagResource", "cloudwatch:UntagResource"]
        Resource = "arn:aws:cloudwatch:us-east-1:${local.account_id}:alarm:robgantz-*"
      },
      {
        Sid    = "Notifications"
        Effect = "Allow"
        Action = [
          "sns:CreateTopic", "sns:DeleteTopic", "sns:SetTopicAttributes", "sns:Subscribe",
          "sns:Unsubscribe", "sns:TagResource", "sns:UntagResource",
        ]
        Resource = "arn:aws:sns:us-east-1:${local.account_id}:robgantz-*"
      },
      {
        Sid      = "Budget"
        Effect   = "Allow"
        Action   = ["budgets:ModifyBudget", "budgets:ViewBudget"]
        Resource = "arn:aws:budgets::${local.account_id}:budget/robgantz-*"
      },
    ]
  })
}

output "tf_plan_role_arn" {
  value = aws_iam_role.tf_plan.arn
}

output "tf_apply_role_arn" {
  value = aws_iam_role.tf_apply.arn
}
