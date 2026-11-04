/**
 * Preference storage + the pre-paint theme script. Kept free of React
 * imports so the server layout can inline the script into the HTML head and
 * the first paint already has the right theme (no flash of the wrong mode).
 */
export const PREFS_STORAGE_KEY = 'axiom.prefs.v1';

export const THEME_SCRIPT = `(function(){try{var raw=window.localStorage.getItem('${PREFS_STORAGE_KEY}');var p=raw?JSON.parse(raw):{};var mode=p.theme||'system';var dark=mode==='dark'||(mode==='system'&&!!window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var root=document.documentElement;root.dataset.theme=dark?'dark':'light';root.dataset.reduceMotion=String(!!p.reduceMotion);root.style.colorScheme=dark?'dark':'light';}catch(e){}})();`;
