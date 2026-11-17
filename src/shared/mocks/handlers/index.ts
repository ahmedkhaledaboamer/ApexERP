import { accountHandlers } from './account'
import { alertsHandlers } from './alerts'
import { authHandlers } from './auth'
import { crmHandlers } from './crm'
import { dashboardHandlers } from './dashboard'
import { departmentHandlers } from './departments'
import { leadImportHandlers } from './leadImport'
import { leadHandlers } from './leads'
import { messagesHandlers } from './messages'
import { quotationsHandlers } from './quotations'
import { reportsHandlers } from './reports'
import { securityHandlers } from './security'
import { serviceHandlers } from './services'
import { settingsHandlers } from './settings'
import { settingsUsersHandlers } from './settingsUsers'
import { targetsHandlers } from './targets'
import { templatesHandlers } from './templates'

/**
 * Every mocked endpoint. Each module adds its handlers here.
 * leadImport comes before leads so `/leads/import...` isn't read as `/leads/:id`.
 */
export const handlers = [
  ...authHandlers,
  ...settingsHandlers,
  ...settingsUsersHandlers,
  ...securityHandlers,
  ...accountHandlers,
  ...templatesHandlers,
  ...leadImportHandlers,
  ...leadHandlers,
  ...messagesHandlers,
  ...dashboardHandlers,
  ...departmentHandlers,
  ...alertsHandlers,
  ...serviceHandlers,
  ...targetsHandlers,
  ...crmHandlers,
  ...quotationsHandlers,
  ...reportsHandlers,
]
