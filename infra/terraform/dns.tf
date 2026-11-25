resource "aws_route53_zone" "main" {
  name    = var.site_domain
  comment = ""

  lifecycle {
    prevent_destroy = true
  }
}

# --- Site: apex and www alias to CloudFront (IPv4 and IPv6) -------------------

resource "aws_route53_record" "site" {
  for_each = {
    apex_a    = { name = var.site_domain, type = "A" }
    apex_aaaa = { name = var.site_domain, type = "AAAA" }
    www_a     = { name = local.www_domain, type = "A" }
    www_aaaa  = { name = local.www_domain, type = "AAAA" }
  }

  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

# --- Certificate issuance: Amazon only, no wildcards ---------------------------

resource "aws_route53_record" "caa" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.site_domain
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 iodef \"mailto:${var.alert_email}\"",
    "0 issue \"amazon.com\"",
    "0 issue \"amazonaws.com\"",
    "0 issue \"amazontrust.com\"",
    "0 issue \"awstrust.com\"",
    "0 issuewild \";\"",
  ]
}

# --- ACM DNS validation --------------------------------------------------------

locals {
  acm_dvo = { for o in aws_acm_certificate.site.domain_validation_options : o.domain_name => o }
}

resource "aws_route53_record" "acm_validation" {
  for_each = toset([var.site_domain, local.www_domain])

  zone_id = aws_route53_zone.main.zone_id
  name    = local.acm_dvo[each.key].resource_record_name
  type    = local.acm_dvo[each.key].resource_record_type
  ttl     = 300
  records = [local.acm_dvo[each.key].resource_record_value]
}

# --- Email: Google Workspace with SPF, DKIM and DMARC --------------------------

resource "aws_route53_record" "mx" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.site_domain
  type    = "MX"
  ttl     = 3600
  records = ["1 smtp.google.com."]
}

resource "aws_route53_record" "spf" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.site_domain
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 include:_spf.google.com ~all"]
}

resource "aws_route53_record" "dkim" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "google._domainkey.${var.site_domain}"
  type    = "TXT"
  ttl     = 3600
  # Public key, published in DNS. Split into two strings because TXT strings max out at 255 characters.
  records = ["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqTXcrVVS3OURetnnspmrZ4/zh4pMg2t0TKK5FfuTe2CqSI5KunvHNgEDx5yPWtkWPq9Ev9UkIGfeOzwAy4etLj/DyH6pN1i29huz+T0EdXwWAz2u5T1v8ys/FwKQTKky3IkW2J7ZoW1X3F9K9fG5vrdnoRjT32mIp3+1FkTg6JN03k95rsbgLv/oO85w\" \"W8+rE6OerQwqUpUnhGVS5PorNRASFKUAFzQ4vqREz8wo0c+6QeIkAkGVsBe581q8ttn/PJVf872/SmtR9mVE1GLfR368L1gwWXpOxm9JyKPIkTMV47hJQA9h+86tkteM+/EsN5xfrv/rH4Of3spJmYC7LQIDAQAB"]
}

resource "aws_route53_record" "dmarc" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "_dmarc.${var.site_domain}"
  type    = "TXT"
  ttl     = 3600
  # Quarantine mail that fails SPF/DKIM alignment; aggregate reports go to the inbox.
  records = ["v=DMARC1; p=quarantine; rua=mailto:${var.alert_email}; fo=1"]
}
