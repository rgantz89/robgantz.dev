variable "site_domain" {
  description = "Apex domain of the site."
  type        = string
  default     = "robgantz.dev"
}

variable "site_bucket_name" {
  description = "S3 bucket that holds the site files. Passed in, not committed."
  type        = string
}

variable "alert_email" {
  description = "Where alarm and budget notifications go."
  type        = string
  default     = "rob@robgantz.dev"
}

variable "github_repo" {
  description = "owner/repo allowed to assume the CI roles."
  type        = string
  default     = "rgantz89/robgantz.dev"
}

variable "github_repo_with_ids" {
  description = "Same repo in GitHub's ID-based OIDC subject format (owner@id/repo@id). These IDs are public."
  type        = string
  default     = "rgantz89@61712886/robgantz.dev@1468291753"
}

variable "slo_target" {
  description = "Availability SLO for the status page and error budget."
  type        = number
  default     = 0.999
}

variable "monthly_budget_usd" {
  description = "Monthly AWS spend that triggers a budget alert."
  type        = number
  default     = 5
}
