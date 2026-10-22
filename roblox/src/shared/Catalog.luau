-- Everything players can earn or buy, shared by the server (which checks prices) and the client (which shows them).
local Catalog = {}

Catalog.RARITY = {
	Common = { color = "9aa5b1", order = 1 },
	Rare = { color = "3a86ff", order = 2 },
	Epic = { color = "a855f7", order = 3 },
	Legendary = { color = "ffb020", order = 4 },
	Mythic = { color = "ff3d7f", order = 5 },
}

-- Skis: colour of the ski and its tip (glow: the tip lights up).
Catalog.skis = {
	{ id = "classic", name = "Classic", price = 0, rarity = "Common", color = "1d3557", tip = "e63946" },
	{ id = "cherry", name = "Cherry", price = 150, rarity = "Common", color = "d62839", tip = "ffffff" },
	{ id = "lime", name = "Lime Rush", price = 350, rarity = "Common", color = "7ed957", tip = "1b4332" },
	{ id = "shadow", name = "Shadow", price = 900, rarity = "Rare", color = "1b1b1f", tip = "ff2d55" },
	{ id = "glacier", name = "Glacier", price = 1500, rarity = "Rare", color = "a8e6ff", tip = "ffffff" },
	{ id = "lava", name = "Lava", price = 3000, rarity = "Epic", color = "ff6a00", tip = "ffd000", glow = true },
	{ id = "galaxy", name = "Galaxy", price = 6000, rarity = "Epic", color = "4c1d95", tip = "f0abfc", glow = true },
	{ id = "gold", name = "24K Gold", pass = "goldGear", rarity = "Legendary", color = "ffc83d", tip = "fff1a8" },
	{ id = "diamond", name = "Diamond", price = 30000, rarity = "Mythic", color = "c7f9ff", tip = "7df9ff" },
}

-- Snowboards: deck colour, an accent stripe, and the bindings.
Catalog.boards = {
	{ id = "starter", name = "Starter Deck", price = 0, rarity = "Common", color = "2f80ed", accent = "ffffff", binding = "1b1b1f" },
	{ id = "sunset", name = "Sunset", price = 300, rarity = "Common", color = "ff7a1a", accent = "ffd23f", binding = "3b1f5c" },
	{ id = "mint", name = "Mint Chip", price = 600, rarity = "Common", color = "5eead4", accent = "3b2a20", binding = "ffffff" },
	{ id = "camo", name = "Arctic Camo", price = 1400, rarity = "Rare", color = "dfe7ee", accent = "7a8ea3", binding = "2d3142" },
	{ id = "neon", name = "Neon Rider", price = 3200, rarity = "Epic", color = "111827", accent = "39ff14", binding = "39ff14", glow = true },
	{ id = "galaxy", name = "Galaxy Deck", price = 7000, rarity = "Epic", color = "3b0764", accent = "f0abfc", binding = "c084fc", glow = true },
	{ id = "gold", name = "Gold Plated", pass = "goldGear", rarity = "Legendary", color = "ffc83d", accent = "fff1a8", binding = "7a4b00" },
	{ id = "crystal", name = "Crystal Board", price = 35000, rarity = "Mythic", color = "bdf4ff", accent = "7df9ff", binding = "ffffff", glow = true },
}

-- The rider: one clean character for everyone, dressed in pieces players pick (see shared/Outfit).
-- Each slot has one item equipped. Colour items recolour the body; the rest add parts:
-- { limb, size, at (studs from the limb's centre, R15 proportions), color, shape, neon, anim }.
Catalog.SKIN_TONE = "f1c27d"
Catalog.SLOTS = { "jackets", "pants", "hats", "goggles", "extras" }
Catalog.SLOT_NAMES = { jackets = "Jackets", pants = "Pants", hats = "Hats", goggles = "Goggles", extras = "Extras" }
Catalog.DEFAULT_OUTFIT = { jackets = "red", pants = "navy", hats = "helmet", goggles = "orange", extras = "none" }

local function hat(color: string, trim: string)
	return {
		{ limb = "Head", size = { 1.36, 0.72, 1.36 }, at = { 0, 0.42, 0.02 }, color = color },
		{ limb = "Head", size = { 1.4, 0.14, 1.4 }, at = { 0, 0.1, 0.02 }, color = trim },
	}
end
local function beanie(color: string, trim: string)
	return {
		{ limb = "Head", size = { 1.3, 0.62, 1.3 }, at = { 0, 0.42, 0 }, color = color },
		{ limb = "Head", size = { 1.36, 0.2, 1.36 }, at = { 0, 0.16, 0 }, color = trim },
		{ limb = "Head", size = { 0.42, 0.42, 0.42 }, at = { 0, 0.88, 0 }, color = trim, shape = "Ball", anim = "bob" },
	}
end
local function goggles(lens: string, neon: boolean?)
	return {
		{ limb = "Head", size = { 1.3, 0.2, 1.3 }, at = { 0, 0.14, 0.01 }, color = "1b1b22" },
		{ limb = "Head", size = { 1.0, 0.34, 0.12 }, at = { 0, 0.14, -0.66 }, color = lens, neon = neon },
	}
end

Catalog.outfit = {
	jackets = {
		{ id = "red", name = "Classic Red", price = 0, rarity = "Common", color = "e94f37" },
		{ id = "blue", name = "Glacier Blue", price = 150, rarity = "Common", color = "2f8cff" },
		{ id = "green", name = "Pine Green", price = 150, rarity = "Common", color = "2f9e5b" },
		{ id = "orange", name = "Sunset", price = 200, rarity = "Common", color = "ff8a1f" },
		{ id = "yellow", name = "Lemon", price = 250, rarity = "Common", color = "ffd23f" },
		{ id = "purple", name = "Grape", price = 350, rarity = "Rare", color = "8b5cf6" },
		{ id = "pink", name = "Bubblegum", price = 350, rarity = "Rare", color = "ff6fb5" },
		{ id = "white", name = "Whiteout", price = 500, rarity = "Rare", color = "f4f6fa" },
		{ id = "black", name = "Midnight", price = 600, rarity = "Epic", color = "1f2430" },
	},
	pants = {
		{ id = "navy", name = "Navy", price = 0, rarity = "Common", color = "2d3142" },
		{ id = "black", name = "Black", price = 100, rarity = "Common", color = "1b1b22" },
		{ id = "grey", name = "Grey", price = 100, rarity = "Common", color = "7c8796" },
		{ id = "blue", name = "Denim", price = 150, rarity = "Common", color = "3b5b99" },
		{ id = "white", name = "Snow White", price = 250, rarity = "Rare", color = "e9edf3" },
		{ id = "red", name = "Racing Red", price = 250, rarity = "Rare", color = "c8352a" },
	},
	hats = {
		{ id = "helmet", name = "White Helmet", price = 0, rarity = "Common", parts = hat("ffffff", "d9dee6") },
		{ id = "none", name = "No Hat", price = 0, rarity = "Common", parts = {} },
		{ id = "helmetBlack", name = "Black Helmet", price = 250, rarity = "Common", parts = hat("1f2430", "3a4252") },
		{ id = "helmetBlue", name = "Blue Helmet", price = 250, rarity = "Common", parts = hat("2f8cff", "1c5fc0") },
		{ id = "beanieRed", name = "Red Beanie", price = 300, rarity = "Common", parts = beanie("e94f37", "ffffff") },
		{ id = "beanieBlue", name = "Blue Beanie", price = 300, rarity = "Common", parts = beanie("2f8cff", "ffffff") },
		{
			id = "cap", name = "Cap", price = 450, rarity = "Rare", parts = {
				{ limb = "Head", size = { 1.28, 0.36, 1.28 }, at = { 0, 0.5, 0 }, color = "1f2430" },
				{ limb = "Head", size = { 1.1, 0.1, 0.7 }, at = { 0, 0.36, -0.86 }, color = "1f2430" },
			},
		},
		{
			id = "headphones", name = "Headphones", price = 700, rarity = "Rare", parts = {
				{ limb = "Head", size = { 1.42, 0.16, 0.3 }, at = { 0, 0.7, 0 }, color = "1f2430" },
				{ limb = "Head", size = { 0.24, 0.56, 0.56 }, at = { -0.7, 0, 0 }, color = "2f8cff" },
				{ limb = "Head", size = { 0.24, 0.56, 0.56 }, at = { 0.7, 0, 0 }, color = "2f8cff" },
			},
		},
		{ id = "helmetGold", name = "Gold Helmet", pass = "goldGear", rarity = "Legendary", parts = hat("ffc83d", "e0a52a") },
	},
	goggles = {
		{ id = "orange", name = "Orange Lens", price = 0, rarity = "Common", parts = goggles("ff9f1c") },
		{ id = "none", name = "No Goggles", price = 0, rarity = "Common", parts = {} },
		{ id = "blue", name = "Blue Mirror", price = 200, rarity = "Common", parts = goggles("3aa0ff") },
		{ id = "purple", name = "Purple Haze", price = 250, rarity = "Common", parts = goggles("a06bff") },
		{ id = "green", name = "Lime Lens", price = 250, rarity = "Common", parts = goggles("7ed957") },
		{ id = "glow", name = "Glow Lens", price = 900, rarity = "Epic", parts = goggles("7df9ff", true) },
	},
	extras = {
		{ id = "none", name = "Nothing", price = 0, rarity = "Common", parts = {} },
		{
			id = "scarf", name = "Scarf", price = 400, rarity = "Common", parts = {
				{ limb = "UpperTorso", size = { 2.1, 0.32, 1.12 }, at = { 0, 0.72, 0 }, color = "ffd23f" },
				{ limb = "UpperTorso", size = { 0.36, 0.9, 0.12 }, at = { 0.5, 0.25, -0.58 }, color = "ffd23f", anim = "flutter" },
			},
		},
		{
			id = "backpack", name = "Backpack", price = 600, rarity = "Rare", parts = {
				{ limb = "UpperTorso", size = { 1.5, 1.4, 0.6 }, at = { 0, -0.05, 0.8 }, color = "2d3142" },
				{ limb = "UpperTorso", size = { 1.1, 0.5, 0.15 }, at = { 0, -0.3, 1.15 }, color = "2f8cff" },
			},
		},
		{
			id = "jetpack", name = "Jetpack", price = 1800, rarity = "Epic", parts = {
				{ limb = "UpperTorso", size = { 1.3, 1.3, 0.5 }, at = { 0, 0, 0.75 }, color = "c9d2dc" },
				{ limb = "UpperTorso", size = { 0.4, 0.5, 0.4 }, at = { -0.35, -0.85, 0.75 }, color = "2d3142" },
				{ limb = "UpperTorso", size = { 0.4, 0.5, 0.4 }, at = { 0.35, -0.85, 0.75 }, color = "2d3142" },
				{ limb = "UpperTorso", size = { 0.3, 0.2, 0.3 }, at = { -0.35, -1.15, 0.75 }, color = "7df9ff", neon = true, anim = "pulse" },
				{ limb = "UpperTorso", size = { 0.3, 0.2, 0.3 }, at = { 0.35, -1.15, 0.75 }, color = "7df9ff", neon = true, anim = "pulse" },
			},
		},
	},
}
-- gloves and boots everyone wears
Catalog.BASE_PARTS = {
	{ limb = "LeftHand", size = { 1.06, 0.36, 1.06 }, at = { 0, 0, 0 }, color = "1f2430" },
	{ limb = "RightHand", size = { 1.06, 0.36, 1.06 }, at = { 0, 0, 0 }, color = "1f2430" },
	{ limb = "LeftFoot", size = { 1.08, 0.4, 1.2 }, at = { 0, 0.02, -0.08 }, color = "1f2430" },
	{ limb = "RightFoot", size = { 1.08, 0.4, 1.2 }, at = { 0, 0.02, -0.08 }, color = "1f2430" },
}

-- Trails left by the skis. `colors` is a list of hex stops (one = solid).
Catalog.trails = {
	{ id = "powder", name = "Powder", price = 0, rarity = "Common", colors = { "c3d4e4" } },
	{ id = "mint", name = "Mint", price = 250, rarity = "Common", colors = { "5eead4" } },
	{ id = "bubblegum", name = "Bubblegum", price = 500, rarity = "Common", colors = { "ff8fd0" } },
	{ id = "ocean", name = "Ocean", price = 1200, rarity = "Rare", colors = { "38bdf8", "1e3a8a" } },
	{ id = "fire", name = "Fire", price = 2500, rarity = "Epic", colors = { "ffd000", "ff3c00", "7a0000" }, glow = true },
	{ id = "toxic", name = "Toxic", price = 4000, rarity = "Epic", colors = { "b6ff00", "00ff6a" }, glow = true },
	{ id = "rainbow", name = "Rainbow", price = 10000, rarity = "Legendary", colors = { "ff004d", "ff9f00", "ffee00", "00e436", "29adff", "a855f7" }, glow = true },
	{ id = "void", name = "Void", price = 25000, rarity = "Mythic", colors = { "000000", "7c3aed", "000000" }, glow = true },
	{ id = "gold", name = "Gold Dust", pass = "goldGear", rarity = "Legendary", colors = { "fff1a8", "ffc83d", "e0a52a" }, glow = true },
}

-- Upgrades are bought level by level with coins.
Catalog.upgrades = {
	{ id = "magnet", name = "Coin Magnet", icon = "magnet", emoji = "🧲", desc = "Grab coins from further away", max = 5, base = 200, growth = 1.9 },
	{ id = "spin", name = "Trick Speed", icon = "lightning", emoji = "🌀", desc = "Flip and spin faster in the air", max = 5, base = 300, growth = 2.0 },
	{ id = "value", name = "Coin Value", icon = "cash", emoji = "💰", desc = "+25% coins from every coin you grab", max = 5, base = 400, growth = 2.1 },
	{ id = "start", name = "Head Start", icon = "rocket", emoji = "🚀", desc = "Start every run going faster", max = 3, base = 500, growth = 2.4 },
}

function Catalog.upgradeCost(u, level: number): number
	return math.floor(u.base * u.growth ^ level / 10 + 0.5) * 10
end

-- what each upgrade level does in game
function Catalog.magnetRadius(level: number): number
	return 1.7 + 0.6 * level
end
function Catalog.trickSpeed(level: number): number
	return 1 + 0.06 * level
end
function Catalog.coinValue(level: number): number
	return 1 + 0.25 * level
end
function Catalog.headStart(level: number): number
	return 5 * level
end

-- Robux. Create these in the Creator Dashboard (Monetization) and put the ids in Config.
Catalog.passes = {
	{ key = "doubleCoins", name = "2x Coins", icon = "coin", emoji = "🪙", desc = "Double coins from every run, forever" },
	{ key = "doubleXp", name = "2x XP", icon = "star", emoji = "⭐", desc = "Level up twice as fast" },
	{ key = "vip", name = "VIP", icon = "vip", emoji = "👑", desc = "Crown tag, gold name and a free revive every run" },
	{ key = "goldGear", name = "Gold Gear", icon = "crown", emoji = "🏆", desc = "Gold skis, board, helmet and trail" },
}
Catalog.products = {
	{ key = "revive", name = "Revive", icon = "heart", emoji = "❤️", desc = "Keep your run going after a crash" },
	{ key = "coins1", name = "Bag of Coins", icon = "bag", emoji = "💰", coins = 1000 },
	{ key = "coins2", name = "Chest of Coins", icon = "chest", emoji = "🧰", coins = 6000 },
	{ key = "coins3", name = "Vault of Coins", icon = "diamond", emoji = "🏦", coins = 20000 },
}

-- Daily login rewards: day 1..7, then the streak loops on day 7.
Catalog.daily = { 100, 150, 250, 350, 500, 750, 1200 }

-- Daily quests: three are picked each day (UTC) from this pool.
Catalog.quests = {
	{ id = "flips", text = "Land %d flips", stat = "flips", goals = { 10, 20, 35 }, reward = 200 },
	{ id = "coins", text = "Collect %d coins", stat = "coins", goals = { 60, 120, 200 }, reward = 200 },
	{ id = "dist", text = "Ski %s m in total", stat = "dist", goals = { 3000, 6000, 10000 }, reward = 250 },
	{ id = "perfect", text = "Land %d perfect tricks", stat = "perfects", goals = { 5, 12, 20 }, reward = 300 },
	{ id = "grind", text = "Grind %d rails", stat = "grinds", goals = { 4, 8, 14 }, reward = 250 },
	{ id = "bounce", text = "Bounce on %d trampolines", stat = "bounces", goals = { 5, 10, 18 }, reward = 250 },
	{ id = "run", text = "Score %s in one run", stat = "bestRun", goals = { 15000, 35000, 70000 }, reward = 400 },
	{ id = "runs", text = "Finish %d runs", stat = "runs", goals = { 5, 10, 15 }, reward = 150 },
}

-- Levels: XP needed to go from `level` to `level + 1`.
function Catalog.xpToNext(level: number): number
	return 200 + (level - 1) * 150
end
function Catalog.levelFromXp(xp: number): (number, number, number)
	local level = 1
	while xp >= Catalog.xpToNext(level) do
		xp -= Catalog.xpToNext(level)
		level += 1
	end
	return level, xp, Catalog.xpToNext(level)
end

function Catalog.find(list, id: string)
	for _, item in list do
		if item.id == id or item.key == id then
			return item
		end
	end
	return nil
end

-- the same three quests for everybody on a given UTC day
function Catalog.questsFor(day: string)
	local h = 0
	for i = 1, #day do
		h = (h * 31 + string.byte(day, i)) % 2147483647
	end
	local rng = Random.new(h)
	local pool = table.clone(Catalog.quests)
	local picked = {}
	for i = 1, 3 do
		local q = table.remove(pool, rng:NextInteger(1, #pool))
		local tier = rng:NextInteger(1, 3)
		table.insert(picked, { id = q.id, slot = i, stat = q.stat, goal = q.goals[tier], reward = q.reward * tier, text = q.text })
	end
	return picked
end

return Catalog
