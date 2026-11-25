# GitHub Actions authenticates to AWS with short-lived OIDC tokens. No stored keys.

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["ab9d0263244dd0326eb67015705a667e79cfe998"]
}

locals {
  # GitHub sends the subject in either format, so trust policies accept both.
  gh_subjects = {
    main        = ["repo:${var.github_repo}:ref:refs/heads/main", "repo:${var.github_repo_with_ids}:ref:refs/heads/main"]
    pr          = ["repo:${var.github_repo}:pull_request", "repo:${var.github_repo_with_ids}:pull_request"]
    environment = ["repo:${var.github_repo}:environment:production", "repo:${var.github_repo_with_ids}:environment:production"]
  }
}

data "aws_iam_policy_document" "gh_trust" {
  for_each = local.gh_subjects

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = each.value
    }
  }
}

# --- Site deploy: upload files and invalidate the cache, nothing else ---------

resource "aws_iam_role" "github_deploy" {
  name                 = "github-deploy-robgantz-dev"
  description          = "GitHub Actions deploy for rgantz89/robgantz.dev (main branch only)"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [
            "repo:${var.github_repo_with_ids}:ref:refs/heads/main",
            "repo:${var.github_repo}:ref:refs/heads/main",
          ]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "deploy-site"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "UploadSiteFiles"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.site.arn}/*"
      },
      {
        Sid      = "InvalidateCache"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
        Resource = aws_cloudfront_distribution.site.arn
      },
    ]
  })
}
