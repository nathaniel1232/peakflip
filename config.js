// Site configuration (plain script so you can edit it without touching the game code).
window.PEAKFLIP_CONFIG = {
  // Supabase project for global leaderboards + race ghosts (run supabase/schema.sql once in the SQL editor).
  // The publishable key is meant to be public; all writes go through validated database functions.
  supabaseUrl: 'https://hbptqumqhdxylqjbxeoa.supabase.co',
  supabaseKey: 'sb_publishable_icbskoqmC0gKi-_7ACfcZQ_nuw717DM',

  // The game's home address. Visitors on any other address (the old *.vercel.app one) get their progress
  // uploaded and are sent here with it, so nobody loses anything. peakflip.io itself redirects to www in Vercel.
  canonicalHost: 'www.peakflip.io',

  // Google AdSense account. Loading its script on every page is also how AdSense verifies the site.
  adsenseClient: 'ca-pub-5606045487621821',
  // Google H5 Games Ads (the ad after a run + "watch an ad" rewards). Ads only appear once Google has approved
  // the site for H5 Games Ads; until then the game simply shows no ad.
  h5GamesAds: true,
  adsTestMode: false,   // true shows Google's test ads instead of real ones

  // Optional AdSense side banners — only on screens ≥1280px wide, never on CrazyGames. Slot ids come from AdSense → Ads → By ad unit.
  adsenseSlotLeft: '',
  adsenseSlotRight: '',
};
