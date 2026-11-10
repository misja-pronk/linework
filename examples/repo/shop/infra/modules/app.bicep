param prefix string
param location string
param apps array
param subnetId string
param logsId string
param vaultName string
param postgresHost string
param registryServer string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${prefix}'
  location: location
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${prefix}'
  location: location
  properties: {
    vnetConfiguration: { infrastructureSubnetId: subnetId }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: reference(logsId, '2023-09-01').customerId
      }
    }
  }
}

resource containerApps 'Microsoft.App/containerApps@2024-03-01' = [for name in apps: {
  name: 'ca-${prefix}-${name}'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      ingress: { external: name == 'web', targetPort: name == 'web' ? 3000 : 8000 }
      registries: [ { server: registryServer, identity: identity.id } ]
      secrets: [ { name: 'db', keyVaultUrl: 'https://${vaultName}.vault.azure.net/secrets/db-password', identity: identity.id } ]
    }
    template: {
      containers: [
        {
          name: name
          image: '${registryServer}/${name}:latest'
          env: [ { name: 'DB_HOST', value: postgresHost } ]
        }
      ]
    }
  }
}]

output urls array = [for (name, i) in apps: 'https://${containerApps[i].properties.configuration.ingress.fqdn}']
