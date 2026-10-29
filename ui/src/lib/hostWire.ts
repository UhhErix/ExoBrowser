// Generated from ExoBridgeProtocol.cs. Run npm run contracts:write after reviewing wire changes.
export type AppUpdateResponse = {
  ok: boolean
  alreadyLatest?: boolean
  updateAvailable?: boolean
  installed?: boolean
  shouldExit?: boolean
  inApp?: boolean
  latest?: string
  current?: string
  message?: string
  upcoming?: WhatsNewWire
  offerOnOpen?: boolean
  notNow?: boolean
  problem?: string
}
export type WhatsNewWire = {
  version: string
  items: WhatsNewItemWire[]
}
export type WhatsNewItemWire = {
  icon: string
  title: string
  detail: string
}
