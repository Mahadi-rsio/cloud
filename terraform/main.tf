terraform {
  required_version = ">= 1.5.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  # Authenticated via CLOUDFLARE_API_TOKEN environment variable
}

resource "cloudflare_r2_bucket" "storage_bucket" {
  account_id    = var.cloudflare_account_id
  name          = "${var.storage_bucket_name}-${var.environment}"
  location_hint = var.storage_bucket_location
}
