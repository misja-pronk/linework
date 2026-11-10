// The shop in Azure: a network, the container apps, PostgreSQL, Key Vault and the logs.
targetScope = 'resourceGroup'

@description('Short name of the environment: dev, test or prod.')
@allowed(['dev', 'test', 'prod'])
param env string = 'prod'
param location string = resourceGroup().location
param apps array = [
  'web'
  'orders'
  'payments'
]
@secure()
param dbAdminPassword string
param enableRedis bool = true

var prefix = 'shop-${env}'
var tags = {
  app: 'shop'
  env: env
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${prefix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    prefix: prefix
    location: location
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${prefix}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    networkAcls: {
      defaultAction: 'Deny'
      virtualNetworkRules: [
        { id: network.outputs.appSubnetId }
      ]
    }
  }
}

resource dbSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'db-password'
  properties: { value: dbAdminPassword }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: 'psql-${prefix}'
  location: location
  sku: { name: 'Standard_D2ds_v5', tier: 'GeneralPurpose' }
  properties: {
    version: '16'
    administratorLogin: 'shop'
    administratorLoginPassword: dbAdminPassword
    network: {
      delegatedSubnetResourceId: network.outputs.dataSubnetId
    }
  }

  resource ordersDb 'databases' = {
    name: 'orders'
  }
}

resource redis 'Microsoft.Cache/redis@2023-08-01' = if (enableRedis) {
  name: 'redis-${prefix}'
  location: location
  properties: {
    sku: { name: 'Standard', family: 'C', capacity: 1 }
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: 'acmeshared'
  scope: resourceGroup('rg-shared')
}

module app 'modules/app.bicep' = {
  name: 'app'
  params: {
    prefix: prefix
    location: location
    apps: apps
    subnetId: network.outputs.appSubnetId
    logsId: logs.id
    vaultName: vault.name
    postgresHost: postgres.properties.fullyQualifiedDomainName
    registryServer: '${registry.name}.azurecr.io'
  }
}

output webUrl string = app.outputs.urls[0]
