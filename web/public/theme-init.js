// Applies the saved Kaala theme before first paint. Keep in step with src/lib/theme.ts.
(function () {
  var theme = null;
  try {
    var saved = window.localStorage.getItem('kaala-theme');
    if (saved === 'night' || saved === 'day') theme = saved;
  } catch (e) {
    // Storage blocked: fall back to the device setting.
  }
  if (!theme) {
    try {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night';
    } catch (e) {
      theme = 'night';
    }
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
