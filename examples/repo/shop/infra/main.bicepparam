using './main.bicep'

param env = 'prod'
param dbAdminPassword = readEnvironmentVariable('DB_ADMIN_PASSWORD')
