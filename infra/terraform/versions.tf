terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # State lives in a private, versioned S3 bucket with native S3 locking.
  # Bucket name is passed at init time so the account ID stays out of the repo:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  www_domain = "www.${var.site_domain}"
  tags = {
    Project   = var.site_domain
    ManagedBy = "terraform"
  }
}
