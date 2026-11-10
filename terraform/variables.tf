variable "cloudflare_account_id" {
  description = "The Cloudflare account ID"
  type        = string
}

variable "environment" {
  description = "Target deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "storage_bucket_name" {
  description = "Name of the Cloudflare R2 storage bucket"
  type        = string
  default     = "cloud-storage"
}

variable "storage_bucket_location" {
  description = "Location hint for Cloudflare R2 bucket"
  type        = string
  default     = "APAC"
}
