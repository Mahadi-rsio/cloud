output "r2_bucket_id" {
  description = "The ID of the provisioned R2 storage bucket"
  value       = cloudflare_r2_bucket.storage_bucket.id
}

output "r2_bucket_name" {
  description = "The name of the provisioned R2 storage bucket"
  value       = cloudflare_r2_bucket.storage_bucket.name
}
