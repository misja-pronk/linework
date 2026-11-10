# The public DNS zone stays in Terraform for now.
resource "azurerm_dns_zone" "shop" {
  name                = "shop.example.com"
  resource_group_name = "rg-shared"
}
