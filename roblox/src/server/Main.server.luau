-- Saves, the shop, daily rewards, quests, codes, Robux purchases, leaderboards and run validation.
-- The ride itself runs on each player's client, as in the web game; the server only trusts
-- a run's result within limits based on how long the run actually lasted.
local DataStoreService = game:GetService("DataStoreService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("PeakFlip")
local Config = require(Shared:WaitForChild("Config"))
local Catalog = require(Shared:WaitForChild("Catalog"))
local Remotes = Shared:WaitForChild("Remotes")
local Lobby = require(script.Parent.Lobby)
local Avatar = require(script.Parent.Avatar)
local IconsServer = require(script.Parent.Icons)

-- Codes players can redeem once each (case-insensitive). Add new ones whenever you like.
local CODES = {
	PEAKFLIP = 250,
	RELEASE = 500,
	OOF = 67,
	SENDIT = 300,
	FROSTY = 400,
}

-- DataStores need "Enable Studio Access to API Services" when testing in Studio; without it
-- the game still runs, it just doesn't save.
local stores = {}
do
	local ok, err = pcall(function()
		stores.save = DataStoreService:GetDataStore(Config.SAVE_STORE)
		stores.allTime = DataStoreService:GetOrderedDataStore(Config.BOARD_ALL_TIME)
	end)
	if not ok then
		warn("[PeakFlip] DataStores unavailable, progress won't be saved:", err)
	end
end

local function today(): string
	return os.date("!%Y-%m-%d") :: string
end
local function dailyStore()
	if not stores.save then
		return nil
	end
	local ok, store = pcall(DataStoreService.GetOrderedDataStore, DataStoreService, Config.BOARD_DAILY_PREFIX .. today())
	return if ok then store else nil
end

local function retry<T>(fn: () -> T, tries: number?): (boolean, T?)
	local n = tries or 3
	local lastErr
	for i = 1, n do
		local ok, result = pcall(fn)
		if ok then
			return true, result
		end
		lastErr = result
		task.wait(i)
	end
	warn("[PeakFlip] DataStore call failed:", lastErr)
	return false, nil
end

-- ---------- profiles ----------
local function defaults()
	return {
		coins = 0,
		best = 0,
		runs = 0,
		xp = 0,
		owned = {
			skis = { classic = true },
			boards = { starter = true },
			trails = { powder = true },
			jackets = { red = true },
			pants = { navy = true },
			hats = { helmet = true, none = true },
			goggles = { orange = true, none = true },
			extras = { none = true },
		},
		equipped = {
			skis = "classic",
			boards = "starter",
			trails = "powder",
			gear = "skis",
			jackets = "red",
			pants = "navy",
			hats = "helmet",
			goggles = "orange",
			extras = "none",
		},
		reviveTokens = 0,
		upgrades = { magnet = 0, spin = 0, value = 0, start = 0 },
		daily = { last = 0, streak = 0 },
		codes = {},
		quests = { day = "", progress = {}, claimed = {} },
		stats = { flips = 0, coins = 0, dist = 0, perfects = 0, grinds = 0, bounces = 0, crashes = 0, playSeconds = 0 },
		settings = { music = true, sfx = true, view = "chase", hints = true, lowGfx = false },
		receipts = {},
	}
end

-- fill in anything an older save is missing
local function merge(into, from)
	if type(from) ~= "table" then
		return into
	end
	for k, v in from do
		if type(v) == "table" and type(into[k]) == "table" then
			merge(into[k], v)
		elseif type(into[k]) == type(v) or into[k] == nil then
			into[k] = v
		end
	end
	return into
end

local profiles = {}
local loaded: { [Player]: boolean } = {} -- false if loading failed: never overwrite a save we couldn't read
local passes: { [Player]: { [string]: boolean } } = {}
local runs: { [Player]: { start: number, revives: number } } = {}

local function key(player: Player): string
	return "u_" .. player.UserId
end

local function questsToday(prof)
	local day = today()
	if prof.quests.day ~= day then
		prof.quests = { day = day, progress = {}, claimed = {} }
	end
	local list = Catalog.questsFor(day)
	for _, q in list do
		q.progress = prof.quests.progress[tostring(q.slot)] or 0
		q.claimed = prof.quests.claimed[tostring(q.slot)] == true
	end
	return list
end

local DAY = 24 * 3600
local DAILY_WAIT = 20 * 3600 -- a little slack so a daily habit doesn't drift later and later
local function dailyState(prof)
	local since = os.time() - prof.daily.last
	local streak = if since > 2 * DAY then 0 else prof.daily.streak
	local ready = since >= DAILY_WAIT
	return {
		ready = ready,
		streak = streak,
		nextDay = (streak % #Catalog.daily) + 1,
		wait = if ready then 0 else DAILY_WAIT - since,
	}
end

-- the copy of a profile the client sees
local function view(player: Player)
	local prof = profiles[player]
	if not prof then
		return nil
	end
	local level, into, need = Catalog.levelFromXp(prof.xp)
	local v = table.clone(prof)
	v.receipts = nil
	v.level, v.xpInto, v.xpNeed = level, into, need
	v.passes = passes[player] or {}
	v.quests = questsToday(prof)
	v.daily = dailyState(prof)
	return v
end

local function save(player: Player)
	local prof = profiles[player]
	if not prof or not loaded[player] or not stores.save then
		return
	end
	retry(function()
		stores.save:UpdateAsync(key(player), function(old)
			-- keep whichever best is higher, in case another server saved meanwhile
			local out = table.clone(prof)
			out.best = math.max(prof.best, if type(old) == "table" then old.best or 0 else 0)
			return out
		end)
	end)
end

local function updateTag(player: Player)
	local prof = profiles[player]
	local char = player.Character
	if prof and char then
		Lobby.setTag(char, player.DisplayName, (Catalog.levelFromXp(prof.xp)), (passes[player] or {}).vip == true)
	end
end

local function publish(player: Player, message: string?)
	local prof = profiles[player]
	if not prof then
		return
	end
	local ls = player:FindFirstChild("leaderstats")
	if ls then
		(ls:FindFirstChild("Level") :: IntValue).Value = (Catalog.levelFromXp(prof.xp));
		(ls:FindFirstChild("Best") :: IntValue).Value = prof.best;
		(ls:FindFirstChild("Coins") :: IntValue).Value = prof.coins
	end
	updateTag(player)
	Remotes.Profile:FireClient(player, view(player), message)
end

local function notify(player: Player, text: string, kind: string?)
	Remotes.Notify:FireClient(player, text, kind or "info")
end

local function checkPasses(player: Player)
	local owned = {}
	for k, id in Config.PASS_IDS do
		if id ~= 0 then
			local ok, has = pcall(MarketplaceService.UserOwnsGamePassAsync, MarketplaceService, player.UserId, id)
			owned[k] = ok and has
		end
	end
	passes[player] = owned
end

local function onPlayerAdded(player: Player)
	local ls = Instance.new("Folder")
	ls.Name = "leaderstats"
	for _, name in { "Level", "Best", "Coins" } do
		local v = Instance.new("IntValue")
		v.Name = name
		v.Parent = ls
	end
	ls.Parent = player

	local prof = defaults()
	loaded[player] = stores.save == nil
	if stores.save then
		local ok, data = retry(function()
			return stores.save:GetAsync(key(player))
		end)
		loaded[player] = ok
		if ok then
			merge(prof, data)
		end
	end
	checkPasses(player)
	if not player.Parent then
		return
	end
	profiles[player] = prof
	publish(player)
	local function dress(char: Model)
		local p = profiles[player]
		if p then
			Avatar.apply(char, p.equipped)
		end
		updateTag(player)
	end
	player.CharacterAdded:Connect(function(char)
		local hum = char:WaitForChild("Humanoid") :: Humanoid
		hum.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
		char:WaitForChild("Head")
		updateTag(player)
	end)
	player.CharacterAppearanceLoaded:Connect(dress)
	if player.Character then
		task.spawn(dress, player.Character)
	end
end
Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	local r = runs[player]
	if r and profiles[player] then
		profiles[player].stats.playSeconds += os.clock() - r.start
	end
	save(player)
	profiles[player] = nil
	loaded[player] = nil
	runs[player] = nil
	passes[player] = nil
end)

game:BindToClose(function()
	for _, player in Players:GetPlayers() do
		task.spawn(save, player)
	end
	task.wait(3)
end)

-- autosave every two minutes
task.spawn(function()
	while true do
		task.wait(120)
		for _, player in Players:GetPlayers() do
			task.spawn(save, player)
		end
	end
end)

-- ---------- leaderboards ----------
local nameCache: { [number]: string } = {}
local function nameOf(userId: number): string
	if nameCache[userId] then
		return nameCache[userId]
	end
	local p = Players:GetPlayerByUserId(userId)
	local name = if p then p.DisplayName else nil
	if not name then
		local ok, n = pcall(Players.GetNameFromUserIdAsync, Players, userId)
		name = if ok then n else "Rider " .. userId
	end
	nameCache[userId] = name
	return name
end

local boardCache = { at = -math.huge, data = { allTime = {}, daily = {} } }
local function readBoard(store)
	if not store then
		return {}
	end
	local ok, pages = retry(function()
		return store:GetSortedAsync(false, Config.BOARD_SIZE)
	end, 2)
	if not ok or not pages then
		return {}
	end
	local rows = {}
	for _, entry in pages:GetCurrentPage() do
		local userId = tonumber(string.match(entry.key, "%d+"))
		if userId then
			table.insert(rows, { userId = userId, name = nameOf(userId), score = entry.value })
		end
	end
	return rows
end

local refreshing = false
local function boards()
	-- cached for 30 s so a full server doesn't hammer the DataStore budget
	if os.clock() - boardCache.at > 30 and not refreshing then
		refreshing = true
		boardCache.data = { allTime = readBoard(stores.allTime), daily = readBoard(dailyStore()) }
		boardCache.at = os.clock()
		refreshing = false
		Lobby.setBoards(boardCache.data)
	end
	return boardCache.data
end

local function submit(player: Player, score: number)
	local k = key(player)
	local function raise(store)
		if not store then
			return
		end
		retry(function()
			store:UpdateAsync(k, function(old)
				if old and old >= score then
					return nil -- keep the higher score; nil cancels the write
				end
				return score
			end)
		end, 2)
	end
	raise(stores.allTime)
	raise(dailyStore())
	boardCache.at = -math.huge -- the next read shows the new score
end

-- ---------- runs ----------
-- While riding, the player's real character waits out of sight; the run itself is drawn on their client.
local function hold(player: Player, on: boolean)
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not char or not root then
		return
	end
	if on then
		root.Anchored = true
		char:PivotTo(CFrame.new(Config.RIDER_HOLD + Vector3.new((player.UserId % 50) * 30, 0, 0)))
	else
		char:PivotTo(Lobby.spawnCFrame())
		root.Anchored = false
	end
end

local function addXp(player: Player, amount: number): number?
	local prof = profiles[player]
	local before = Catalog.levelFromXp(prof.xp)
	prof.xp += amount
	local after = Catalog.levelFromXp(prof.xp)
	return if after > before then after else nil
end

local function finishRun(player: Player, result)
	local run = runs[player]
	local prof = profiles[player]
	runs[player] = nil
	if not run or not prof or type(result) ~= "table" then
		return nil
	end
	local elapsed = os.clock() - run.start
	local function num(v, cap: number): number
		local n = math.floor(tonumber(v) or 0)
		if n ~= n or n < 0 then
			return 0
		end
		return math.min(n, cap)
	end
	local score = num(result.score, math.floor(Config.MAX_SCORE_FLAT + elapsed * Config.MAX_SCORE_PER_SECOND))
	local coins = num(result.coins, math.floor(10 + elapsed * Config.MAX_COINS_PER_SECOND))
	local dist = num(result.dist, math.floor(80 * elapsed + 50))
	local s = if type(result.stats) == "table" then result.stats else {}
	local runStats = {
		flips = num(s.flips, 400),
		perfects = num(s.perfects, 400),
		grinds = num(s.grinds, 200),
		bounces = num(s.bounces, 300),
		coins = coins,
		dist = dist,
		runs = 1,
		bestRun = score,
	}

	local mine = passes[player] or {}
	local collected = math.floor(coins * Catalog.coinValue(prof.upgrades.value))
	local bonus = math.floor(score / Config.COIN_BONUS_DIVISOR)
	local earned = collected + bonus
	local doubled = mine.doubleCoins == true
	if doubled then
		earned *= 2
	end
	local xp = math.floor(score / Config.XP_SCORE_DIVISOR + dist / Config.XP_DIST_DIVISOR)
	if mine.doubleXp then
		xp *= 2
	end

	prof.runs += 1
	prof.coins += earned
	local newBest = score > prof.best
	if newBest then
		prof.best = score
	end
	for k, v in runStats do
		if prof.stats[k] ~= nil then
			prof.stats[k] += v
		end
	end
	prof.stats.crashes += 1
	prof.stats.playSeconds += elapsed
	local levelUp = addXp(player, xp)

	-- quest progress
	local done = {}
	for _, q in questsToday(prof) do
		local slot = tostring(q.slot)
		local before = prof.quests.progress[slot] or 0
		local after = if q.stat == "bestRun" then math.max(before, runStats.bestRun) else before + (runStats[q.stat] or 0)
		prof.quests.progress[slot] = math.min(after, q.goal)
		if before < q.goal and after >= q.goal then
			table.insert(done, string.format(q.text, q.goal))
		end
	end

	publish(player)
	if score > 0 then
		task.spawn(submit, player, score)
	end
	task.spawn(save, player)
	return {
		score = score,
		newBest = newBest,
		collected = collected,
		bonus = bonus,
		doubled = doubled,
		earned = earned,
		xp = xp,
		levelUp = levelUp,
		quests = done,
	}
end

-- ---------- actions from the client ----------
local function fail(msg: string)
	return { ok = false, msg = msg }
end

local actions = {}

function actions.rideStart(player: Player)
	runs[player] = { start = os.clock(), revives = 0 }
	hold(player, true)
	return { ok = true }
end

function actions.rideEnd(player: Player)
	runs[player] = nil
	hold(player, false)
	return { ok = true }
end

-- A revive is free once a run with VIP; otherwise it uses a revive bought with Robux.
function actions.revive(player: Player)
	local run, prof = runs[player], profiles[player]
	if not run then
		return fail("No run")
	end
	if run.revives >= Config.MAX_REVIVES then
		return fail("No more revives this run")
	end
	local vipFree = run.revives == 0 and (passes[player] or {}).vip == true
	if not vipFree then
		if (prof.reviveTokens or 0) <= 0 then
			return fail("No revives left")
		end
		prof.reviveTokens -= 1
	end
	run.revives += 1
	publish(player)
	return { ok = true }
end

local LISTS = { skis = Catalog.skis, boards = Catalog.boards, trails = Catalog.trails }
for _, slot in Catalog.SLOTS do
	LISTS[slot] = Catalog.outfit[slot]
end
local function itemList(kind)
	return if type(kind) == "string" then LISTS[kind] else nil
end

-- equipping skis or a board also picks that as your gear; outfit pieces go on your character right away
local function equipped(player: Player, kind: string)
	local prof = profiles[player]
	if kind == "skis" then
		prof.equipped.gear = "skis"
	elseif kind == "boards" then
		prof.equipped.gear = "board"
	elseif Catalog.outfit[kind] and player.Character then
		task.spawn(function()
			Avatar.apply(player.Character, prof.equipped)
			updateTag(player)
		end)
	end
end

function actions.buy(player: Player, arg)
	local prof = profiles[player]
	local kind = type(arg) == "table" and arg.kind
	local list = itemList(kind)
	local item = list and Catalog.find(list, arg.id)
	if not item then
		return fail("Unknown item")
	end
	prof.owned[kind] = prof.owned[kind] or {}
	if prof.owned[kind][item.id] then
		return fail("Already owned")
	end
	if item.pass then
		-- game pass items are free with the pass
		if not (passes[player] or {})[item.pass] then
			return fail("Needs the game pass")
		end
	elseif prof.coins < item.price then
		return fail("Not enough coins")
	else
		prof.coins -= item.price
	end
	prof.owned[kind][item.id] = true
	prof.equipped[kind] = item.id
	equipped(player, kind)
	publish(player)
	task.spawn(save, player)
	return { ok = true }
end

function actions.equip(player: Player, arg)
	local prof = profiles[player]
	local kind = type(arg) == "table" and arg.kind
	if not itemList(kind) or not (prof.owned[kind] or {})[arg.id] then
		return fail("Not owned")
	end
	prof.equipped[kind] = arg.id
	equipped(player, kind)
	publish(player)
	return { ok = true }
end

function actions.gear(player: Player, kind)
	if kind ~= "skis" and kind ~= "board" then
		return fail("Unknown gear")
	end
	profiles[player].equipped.gear = kind
	publish(player)
	return { ok = true }
end

function actions.upgrade(player: Player, id)
	local prof = profiles[player]
	local u = Catalog.find(Catalog.upgrades, id)
	if not u then
		return fail("Unknown upgrade")
	end
	local level = prof.upgrades[u.id] or 0
	if level >= u.max then
		return fail("Maxed out")
	end
	local cost = Catalog.upgradeCost(u, level)
	if prof.coins < cost then
		return fail("Not enough coins")
	end
	prof.coins -= cost
	prof.upgrades[u.id] = level + 1
	publish(player)
	task.spawn(save, player)
	return { ok = true }
end

function actions.claimDaily(player: Player)
	local prof = profiles[player]
	local d = dailyState(prof)
	if not d.ready then
		return fail("Come back later")
	end
	local reward = Catalog.daily[d.nextDay]
	prof.coins += reward
	prof.daily = { last = os.time(), streak = d.streak + 1 }
	publish(player)
	task.spawn(save, player)
	return { ok = true, coins = reward, day = d.nextDay }
end

function actions.claimQuest(player: Player, slot)
	local prof = profiles[player]
	for _, q in questsToday(prof) do
		if q.slot == slot then
			if q.claimed then
				return fail("Already claimed")
			end
			if q.progress < q.goal then
				return fail("Not finished yet")
			end
			prof.quests.claimed[tostring(slot)] = true
			prof.coins += q.reward
			local levelUp = addXp(player, math.floor(q.reward / 2))
			publish(player)
			task.spawn(save, player)
			return { ok = true, coins = q.reward, levelUp = levelUp }
		end
	end
	return fail("Unknown quest")
end

function actions.redeem(player: Player, code)
	local prof = profiles[player]
	if type(code) ~= "string" then
		return fail("Invalid code")
	end
	code = string.upper((string.gsub(code, "%s", "")))
	local reward = CODES[code]
	if not reward then
		return fail("Invalid code")
	end
	if prof.codes[code] then
		return fail("Already redeemed")
	end
	prof.codes[code] = true
	prof.coins += reward
	publish(player)
	task.spawn(save, player)
	return { ok = true, coins = reward }
end

local VIEWS = { chase = true, high = true, first = true, side = true }
function actions.settings(player: Player, s)
	local prof = profiles[player]
	if type(s) ~= "table" then
		return fail("Bad settings")
	end
	for _, k in { "music", "sfx", "hints", "lowGfx" } do
		if type(s[k]) == "boolean" then
			prof.settings[k] = s[k]
		end
	end
	if VIEWS[s.view] then
		prof.settings.view = s.view
	end
	return { ok = true }
end

local lastAction: { [Player]: number } = {}
Remotes.Action.OnServerInvoke = function(player, name, arg)
	if not profiles[player] then
		return fail("Still loading")
	end
	local fn = actions[name]
	if not fn then
		return fail("Unknown action")
	end
	-- a light rate limit on shop-style calls (the ride's own calls are already one per run)
	if name ~= "rideStart" and name ~= "rideEnd" and name ~= "revive" then
		local t = os.clock()
		if lastAction[player] and t - lastAction[player] < 0.15 then
			return fail("Slow down")
		end
		lastAction[player] = t
	end
	return fn(player, arg)
end

Remotes.RunFinished.OnServerInvoke = function(player, result)
	return finishRun(player, result)
end

Remotes.GetLeaderboards.OnServerInvoke = function(player)
	local data = boards()
	return { allTime = data.allTime, daily = data.daily, profile = view(player) }
end

-- ---------- Robux ----------
MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, bought)
	if not bought then
		return
	end
	for k, id in Config.PASS_IDS do
		if id == passId then
			passes[player] = passes[player] or {}
			passes[player][k] = true
			publish(player)
			local pass = Catalog.find(Catalog.passes, k)
			notify(player, "Thanks! " .. (if pass then pass.name else "Pass") .. " unlocked", "success")
		end
	end
end)

MarketplaceService.ProcessReceipt = function(receipt)
	local player = Players:GetPlayerByUserId(receipt.PlayerId)
	local prof = player and profiles[player]
	if not prof then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	if prof.receipts[receipt.PurchaseId] then
		return Enum.ProductPurchaseDecision.PurchaseGranted
	end
	for k, id in Config.PRODUCT_IDS do
		if id ~= 0 and id == receipt.ProductId then
			local product = Catalog.find(Catalog.products, k)
			if k == "revive" then
				-- kept until used, so a revive bought just as the run ended isn't lost
				prof.reviveTokens = (prof.reviveTokens or 0) + 1
				prof.receipts[receipt.PurchaseId] = true
				save(player)
				publish(player)
				Remotes.Revive:FireClient(player)
				return Enum.ProductPurchaseDecision.PurchaseGranted
			end
			prof.coins += product.coins
			-- remember recent receipts so a retried receipt isn't granted twice
			local n = 0
			for _ in prof.receipts do
				n += 1
			end
			if n >= 50 then
				prof.receipts = {}
			end
			prof.receipts[receipt.PurchaseId] = true
			save(player)
			publish(player)
			notify(player, "+" .. product.coins .. " coins. Thank you!", "success")
			return Enum.ProductPurchaseDecision.PurchaseGranted
		end
	end
	return Enum.ProductPurchaseDecision.NotProcessedYet
end

-- ---------- lobby ----------
IconsServer.publish()
Lobby.build()
task.spawn(function()
	while true do
		boards()
		task.wait(60)
	end
end)
