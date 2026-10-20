// Site configuration (plain script so you can edit it without touching the game code).
window.PEAKFLIP_CONFIG = {
  // Supabase project for global leaderboards + race ghosts (run supabase/schema.sql once in the SQL editor).
  // The publishable key is meant to be public; all writes go through validated database functions.
  supabaseUrl: 'https://hbptqumqhdxylqjbxeoa.supabase.co',
  supabaseKey: 'sb_publishable_icbskoqmC0gKi-_7ACfcZQ_nuw717DM',

  // Google H5 Games Ads (rewarded + between-run ads on your own site). Needs an approved AdSense account.
  h5GamesAds: false,
  adsTestMode: true,   // shows Google's test ads; set false once approved and live

  // Google AdSense side banners — only shown on screens ≥1280px wide and never on CrazyGames.
  // Fill these in after AdSense approves your site, e.g. adsenseClient: 'ca-pub-1234567890123456'
  adsenseClient: '',
  adsenseSlotLeft: '',
  adsenseSlotRight: '',
};
