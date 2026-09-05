import { applyTheme, loadTheme } from './theme'
import './components/bg-app'

// Applied before the app renders, so the page never paints in one theme
// and then flips to the other — see
// docs/SCRUM/TODO/Feature.EnableDarkmode.md's no-flash requirement.
// bg-app.ts takes over from here when the player changes the setting.
applyTheme(loadTheme())
