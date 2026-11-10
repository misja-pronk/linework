// Region names per geography, in the order a first, second and third region are usually added
// (a paired region second where the vendor has one).

export const azureGeographies = [
  { value: 'europe', label: 'Europe', help: 'West Europe, North Europe, Sweden Central', regions: ['westeurope', 'northeurope', 'swedencentral'], short: ['weu', 'neu', 'sdc'] },
  { value: 'us', label: 'United States', help: 'East US 2, Central US, West US 3', regions: ['eastus2', 'centralus', 'westus3'], short: ['eus2', 'cus', 'wus3'] },
  { value: 'uk', label: 'United Kingdom', help: 'UK South, UK West, North Europe', regions: ['uksouth', 'ukwest', 'northeurope'], short: ['uks', 'ukw', 'neu'] },
];

export const awsGeographies = [
  { value: 'europe', label: 'Europe', help: 'eu-west-1 (Ireland), eu-central-1 (Frankfurt)', regions: ['eu-west-1', 'eu-central-1'] },
  { value: 'us', label: 'United States', help: 'us-east-1 (N. Virginia), us-west-2 (Oregon)', regions: ['us-east-1', 'us-west-2'] },
];
