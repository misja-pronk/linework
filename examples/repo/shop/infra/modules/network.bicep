param prefix string
param location string

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: 'vnet-${prefix}'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [
      {
        name: 'snet-apps'
        properties: { addressPrefix: '10.40.0.0/23' }
      }
      {
        name: 'snet-data'
        properties: {
          addressPrefix: '10.40.2.0/24'
          delegations: [
            { name: 'pg', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }
          ]
        }
      }
    ]
  }
}

output appSubnetId string = '${vnet.id}/subnets/snet-apps'
output dataSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-data')
