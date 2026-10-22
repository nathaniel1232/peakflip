-- The lobby HUD (level, coins, side buttons, PLAY) and every window: shop, daily rewards,
-- quests, codes, stats, leaderboard, settings, plus the end-of-run results screen.
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local Kit = require(script.Parent.Kit)
local Preview = require(script.Parent.Preview)
local Sfx = require(script.Parent.Parent.Sfx)
local Util = require(script.Parent.Parent.Util)
local Shared = ReplicatedStorage:WaitForChild("PeakFlip")
local Catalog = require(Shared:WaitForChild("Catalog"))
local Config = require(Shared:WaitForChild("Config"))

local C, make, text = Kit.C, Kit.make, Kit.text
local commas = Util.commas
local hex = Color3.fromHex
local player = Players.LocalPlayer
local isStudio = RunService:IsStudio()

local Menus = {}
local cb = {} :: { [string]: any }
local profile: any = nil
local boards: any = {}
local lobby = {} :: { [string]: any }
local refreshers: { () -> () } = {}

local function tween(o: Instance, t: number, goal, style: Enum.EasingStyle?)
	local tw = TweenService:Create(o, TweenInfo.new(t, style or Enum.EasingStyle.Quad, Enum.EasingDirection.Out), goal)
	tw:Play()
	return tw
end

local function action(name: string, arg: any?)
	local res = cb.onAction(name, arg)
	if res and not res.ok and res.msg then
		Kit.toast(res.msg, "error")
		Sfx.error()
	end
	return res
end

local function fmtTime(seconds: number): string
	seconds = math.max(0, math.floor(seconds))
	local hh, mm, ss = math.floor(seconds / 3600), math.floor(seconds % 3600 / 60), seconds % 60
	if hh > 0 then
		return string.format("%dh %02dm", hh, mm)
	end
	return string.format("%dm %02ds", mm, ss)
end

local function rarityColor(r: string): Color3
	return hex((Catalog.RARITY[r] or Catalog.RARITY.Common).color)
end

local function scroller(parent: Instance, props)
	local base = {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 8,
		ScrollBarImageColor3 = C.white,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
		Size = UDim2.fromScale(1, 1),
		Parent = parent,
	}
	for k, v in props or {} do
		base[k] = v
	end
	return make("ScrollingFrame", base)
end

local function clear(frame: Instance)
	for _, c in frame:GetChildren() do
		if c:IsA("GuiObject") then
			c:Destroy()
		end
	end
end

-- tabs along the top of a window; entries are { id, label, width?, icon?, emoji? }. Returns a picker.
local function tabs(parent: Instance, list, onPick: (string) -> ())
	local row = make("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 50), Parent = parent }, { Kit.list(Enum.FillDirection.Horizontal, 8) })
	local buttons = {}
	local function pick(id: string)
		for key, b in buttons do
			Kit.setButtonColor(b, if key == id then C.blue else C.panel2)
		end
		onPick(id)
	end
	for i, t in list do
		buttons[t[1]] = Kit.button({ Parent = row, Text = t[2], Icon = t[4], IconFallback = t[5], IconSize = 0.9, Color = C.panel2, Size = UDim2.fromOffset(t[3] or 130, 44), TextSize = 19, LayoutOrder = i }, function()
			pick(t[1])
		end)
	end
	return pick, buttons
end

-- ---------- lobby HUD ----------
local function buildLobby(gui: ScreenGui)
	local root = make("Frame", { Name = "Lobby", BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Parent = gui })
	lobby.root = root

	-- level + XP and coins, centred along the top (Roblox's chat sits top left, the player list top right)
	local topRow = make("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 10), Size = UDim2.fromOffset(520, 64), Parent = root }, {
		Kit.list(Enum.FillDirection.Horizontal, 20, Enum.HorizontalAlignment.Center, Enum.VerticalAlignment.Center),
	})
	local lvl = make("Frame", { BackgroundTransparency = 1, Size = UDim2.fromOffset(270, 64), LayoutOrder = 1, Parent = topRow })
	lobby.xp = Kit.bar({ Parent = lvl, Position = UDim2.fromOffset(50, 18), Size = UDim2.fromOffset(216, 28), Color = C.blue, TextSize = 15 })
	local star = Kit.icon("star", function()
		return make("Frame", { BackgroundColor3 = C.blue }, { Kit.round(), Kit.stroke(3, C.ink) })
	end, { Parent = lvl, Size = UDim2.fromOffset(64, 64), ZIndex = 3 })
	lobby.level = text({ Parent = star, Text = "1", TextSize = 26, Size = UDim2.fromScale(1, 1), Position = UDim2.fromOffset(0, 3), ZIndex = 5, Outline = 3 })

	local coins = make("Frame", { BackgroundColor3 = C.ink, BackgroundTransparency = 0.15, Size = UDim2.fromOffset(220, 56), LayoutOrder = 2, Parent = topRow }, { Kit.round(), Kit.stroke(3, C.ink) })
	Kit.coin(54, coins, UDim2.fromOffset(-4, 1))
	lobby.coins = text({ Parent = coins, Text = "0", TextSize = 30, Position = UDim2.fromOffset(56, 0), Size = UDim2.new(1, -110, 1, 0), TextXAlignment = Enum.TextXAlignment.Left })
	lobby.coinScale = make("UIScale", { Parent = coins })
	Kit.button({ Parent = coins, Text = "", Icon = "plus", IconFallback = "+", IconSize = 0.9, Color = C.green, AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -6, 0.5, -2), Size = UDim2.fromOffset(42, 42), Radius = 21 }, function()
		Menus.openShop("robux")
	end)

	-- side buttons, each with a big icon from the pack
	local side = make("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.new(0, 16, 0.53, 0), Size = UDim2.fromOffset(196, 460), Parent = root }, {
		make("UIGridLayout", { CellSize = UDim2.fromOffset(88, 88), CellPadding = UDim2.fromOffset(14, 18), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	lobby.dots = {}
	local entries = {
		{ "shop", "shop", "🛒", "SHOP", C.blue, function() Menus.openShop("outfit") end },
		{ "daily", "gift", "🎁", "DAILY", C.blue, function() Kit.open("daily") end },
		{ "quests", "scroll", "📜", "QUESTS", C.blue, function() Kit.open("quests") end },
		{ "codes", "codes", "🎫", "CODES", C.blue, function() Kit.open("codes") end },
		{ "stats", "stats", "📊", "STATS", C.blue, function() Kit.open("stats") end },
		{ "top", "trophy", "🏆", "TOP", C.blue, function() Kit.open("leaderboard") end },
		{ "settings", "settings", "⚙️", "SETTINGS", C.grey, function() Kit.open("settings") end },
		{ "vip", "vip", "👑", "VIP", C.blue, function() Menus.openShop("robux") end },
	}
	for i, e in entries do
		local holder, face = Kit.button({ Parent = side, Color = e[5], LayoutOrder = i, Radius = 18 }, e[6])
		Kit.icon(e[2], e[3], { Parent = face, Size = UDim2.fromScale(0.82, 0.82), AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, -10), ZIndex = 3, Rotation = -6 })
		text({ Parent = face, Text = e[4], TextSize = 15, Position = UDim2.fromScale(0, 0.68), Size = UDim2.new(1, 0, 0.3, 0), ZIndex = 4 })
		lobby.dots[e[1]] = Kit.dot(holder)
	end

	-- skis or snowboard
	local gear = make("Frame", { BackgroundColor3 = C.ink, BackgroundTransparency = 0.2, AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -146), Size = UDim2.fromOffset(300, 54), Parent = root }, {
		Kit.round(),
		Kit.stroke(3, C.ink),
		Kit.padding(5),
		Kit.list(Enum.FillDirection.Horizontal, 6, Enum.HorizontalAlignment.Center),
	})
	lobby.gear = {}
	for i, g in { { "skis", "SKIS", "rocket", "🎿" }, { "board", "SNOWBOARD", "board", "🏂" } } do
		lobby.gear[g[1]] = Kit.button({ Parent = gear, Text = g[2], Icon = g[3], IconFallback = g[4], Color = C.panel2, Size = UDim2.new(0.5, -3, 1, -4), TextSize = 18, LayoutOrder = i, Radius = 20 }, function()
			if profile and profile.equipped.gear ~= g[1] then
				action("gear", g[1])
			end
		end)
	end

	-- PLAY
	local play, playFace = Kit.button({ Parent = root, Text = "PLAY", Icon = "lightning", IconFallback = "▶", Color = C.green, AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -40), Size = UDim2.fromOffset(300, 90), TextSize = 48, Radius = 24 }, function()
		cb.onPlay()
	end)
	lobby.play = play
	text({ Parent = root, Text = "or step on the glowing mat by the doors", TextSize = 16, AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -10), Size = UDim2.fromOffset(360, 22), TextColor3 = Kit.lighten(C.sky, 0.6) })
	-- a gentle pulse so it's obvious what to press
	local pulse = make("UIScale", { Parent = playFace })
	task.spawn(function()
		while true do
			tween(pulse, 0.7, { Scale = 1.05 }, Enum.EasingStyle.Sine).Completed:Wait()
			tween(pulse, 0.7, { Scale = 1 }, Enum.EasingStyle.Sine).Completed:Wait()
		end
	end)

	-- best score + equipped gear, bottom left
	lobby.best = text({ Parent = root, Text = "", TextSize = 20, AnchorPoint = Vector2.new(0, 1), Position = UDim2.new(0, 18, 1, -18), Size = UDim2.fromOffset(340, 26), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = C.gold })
end

-- ---------- shop ----------
local shop = {} :: { [string]: any }
local function shopCard(parent: Instance, order: number, rarity: string, title: string)
	local color = rarityColor(rarity)
	local card = make("Frame", { BackgroundColor3 = C.panel2, LayoutOrder = order, Parent = parent }, {
		Kit.corner(16),
		Kit.stroke(1.5, C.ink),
	})
	-- a soft spotlight behind the 3D model
	make("Frame", { BackgroundColor3 = C.white, BackgroundTransparency = 0.9, AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 14), Size = UDim2.fromOffset(120, 120), Parent = card }, { Kit.round() })
	text({ Parent = card, Text = title, TextSize = 20, Position = UDim2.fromOffset(0, 146), Size = UDim2.new(1, 0, 0, 24) })
	text({ Parent = card, Text = string.upper(rarity), TextSize = 13, TextColor3 = Kit.lighten(color, 0.5), Position = UDim2.fromOffset(0, 170), Size = UDim2.new(1, 0, 0, 16) })
	return card
end

local function passButton(card: Frame, kind: string, item)
	local hasPass = profile.passes[item.pass] == true
	local pass = Catalog.find(Catalog.passes, item.pass)
	Kit.button({
		Parent = card,
		Text = if hasPass then "GET" else (if pass then pass.name else "Pass"),
		Icon = if hasPass then nil else "robux",
		IconFallback = "R$",
		Color = C.green,
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -12),
		Size = UDim2.new(1, -24, 0, 42),
		TextSize = 19,
	}, function()
		if hasPass then
			if action("buy", { kind = kind, id = item.id }).ok then
				Sfx.buy()
				Kit.toast(item.name .. " unlocked!", "success")
			end
		elseif (Config.PASS_IDS[item.pass] or 0) ~= 0 then
			MarketplaceService:PromptGamePassPurchase(player, Config.PASS_IDS[item.pass])
		else
			Kit.toast("This game pass isn't on sale yet", "info")
		end
	end)
end

local function priceButton(card: Frame, kind: string, item)
	local owned = profile.owned[kind] and profile.owned[kind][item.id]
	if item.pass and not owned then
		return passButton(card, kind, item)
	end
	local gearKind = if kind == "skis" then "skis" elseif kind == "boards" then "board" else nil
	local equipped = profile.equipped[kind] == item.id and (gearKind == nil or profile.equipped.gear == gearKind)
	local label, color, icon, emoji
	item = table.clone(item)
	item.price = item.price or 0
	if equipped then
		label, color, icon, emoji = "EQUIPPED", C.grey, "check", "✔"
	elseif owned then
		label, color = "EQUIP", C.blue
	else
		label = if item.price == 0 then "FREE" else commas(item.price)
		color = if profile.coins >= item.price then C.green else C.red
		icon, emoji = if item.price == 0 then nil else "coin", if item.price == 0 then nil else "$"
	end
	Kit.button({ Parent = card, Text = label, Icon = icon, IconFallback = emoji, Color = color, AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -12), Size = UDim2.new(1, -24, 0, 42), TextSize = 21 }, function()
		if equipped then
			return
		end
		if owned then
			if action("equip", { kind = kind, id = item.id }).ok then
				Kit.toast(item.name .. " equipped", "success")
			end
		elseif profile.coins < item.price then
			Kit.toast("You need " .. commas(item.price - profile.coins) .. " more coins", "error")
			Sfx.error()
		elseif action("buy", { kind = kind, id = item.id }).ok then
			Sfx.buy()
			Kit.toast("Bought " .. item.name .. "!", "success")
		end
	end)
	if not owned and profile.coins < (item.price or 0) then
		Kit.icon("lock", "🔒", { Parent = card, Size = UDim2.fromOffset(34, 34), Position = UDim2.fromOffset(8, 8), ZIndex = 3 })
	end
end

local function itemCard(parent: Instance, order: number, kind: string, item)
	local card = shopCard(parent, order, item.rarity, item.name)
	Preview.new(card, kind, item, { Position = UDim2.fromOffset(6, 4), Size = UDim2.new(1, -12, 0, 140) })
	priceButton(card, kind, item)
end

local function upgradeCard(parent: Instance, order: number, u)
	local level = profile.upgrades[u.id] or 0
	local card = make("Frame", { BackgroundColor3 = C.panel2, LayoutOrder = order, Parent = parent }, {
		Kit.corner(16),
		Kit.stroke(1.5, C.ink),
	})
	Kit.icon(u.icon, u.emoji, { Parent = card, Size = UDim2.fromOffset(84, 84), AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 10) })
	text({ Parent = card, Text = u.name, TextSize = 21, Position = UDim2.fromOffset(0, 98), Size = UDim2.new(1, 0, 0, 24) })
	text({ Parent = card, Text = u.desc, Font = Kit.BODY, TextSize = 13, TextWrapped = true, Position = UDim2.fromOffset(10, 122), Size = UDim2.new(1, -20, 0, 32), TextColor3 = Kit.lighten(C.sky, 0.6), Outline = 1 })
	local pips = make("Frame", { BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 158), Size = UDim2.new(1, 0, 0, 14), Parent = card }, { Kit.list(Enum.FillDirection.Horizontal, 5, Enum.HorizontalAlignment.Center) })
	for i = 1, u.max do
		make("Frame", { BackgroundColor3 = if i <= level then C.green else C.ink, Size = UDim2.fromOffset(22, 12), LayoutOrder = i, Parent = pips }, { Kit.round(), Kit.stroke(1.5, C.ink) })
	end
	local maxed = level >= u.max
	local cost = if maxed then 0 else Catalog.upgradeCost(u, level)
	Kit.button({
		Parent = card,
		Text = if maxed then "MAX" else commas(cost),
		Icon = if maxed then "check" else "coin",
		IconFallback = if maxed then "✔" else "$",
		Color = if maxed then C.grey elseif profile.coins >= cost then C.green else C.red,
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -12),
		Size = UDim2.new(1, -24, 0, 42),
		TextSize = 21,
	}, function()
		if maxed then
			return
		end
		if profile.coins < cost then
			Kit.toast("You need " .. commas(cost - profile.coins) .. " more coins", "error")
			Sfx.error()
		elseif action("upgrade", u.id).ok then
			Sfx.buy()
			Kit.toast(u.name .. " upgraded to level " .. (level + 1) .. "!", "success")
		end
	end)
end

local function robuxCard(parent: Instance, order: number, item, isPass: boolean)
	local id = if isPass then Config.PASS_IDS[item.key] else Config.PRODUCT_IDS[item.key]
	if (id or 0) == 0 and not isStudio then
		return false
	end
	local owned = isPass and profile.passes[item.key]
	local card = make("Frame", { BackgroundColor3 = C.panel2, LayoutOrder = order, Parent = parent }, {
		Kit.corner(16),
		Kit.stroke(1.5, C.ink),
	})
	make("Frame", { BackgroundColor3 = C.white, BackgroundTransparency = 0.9, AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 10), Size = UDim2.fromOffset(100, 100), Parent = card }, { Kit.round() })
	Kit.icon(item.icon, item.emoji, { Parent = card, Size = UDim2.fromOffset(96, 96), AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 12) })
	text({ Parent = card, Text = item.name, TextSize = 21, Position = UDim2.fromOffset(0, 112), Size = UDim2.new(1, 0, 0, 24) })
	text({
		Parent = card,
		Text = if isPass or not item.coins then item.desc else "+" .. commas(item.coins) .. " coins",
		Font = Kit.BODY,
		TextSize = 13,
		TextWrapped = true,
		Position = UDim2.fromOffset(10, 136),
		Size = UDim2.new(1, -20, 0, 34),
		Outline = 1,
	})
	local label = if owned then "OWNED" elseif (id or 0) == 0 then "Set id in Config" else "BUY"
	Kit.button({ Parent = card, Text = label, Icon = if owned or (id or 0) == 0 then nil else "robux", IconFallback = "R$", Color = if owned then C.grey else C.green, AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -12), Size = UDim2.new(1, -24, 0, 42), TextSize = if (id or 0) == 0 then 15 else 22 }, function()
		if owned or (id or 0) == 0 then
			return
		end
		if isPass then
			MarketplaceService:PromptGamePassPurchase(player, id)
		else
			MarketplaceService:PromptProductPurchase(player, id)
		end
	end)
	return true
end

local function buildShop()
	local w = Kit.window("shop", "SHOP", C.blue, Vector2.new(980, 680), "shop", "🛒")
	local body = w.body
	local grid = scroller(body, { Position = UDim2.fromOffset(0, 62), Size = UDim2.new(1, 0, 1, -62) })
	-- the outfit tab has a second row of tabs, one per slot
	local slotRow = make("Frame", { BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 58), Size = UDim2.new(1, 0, 0, 40), Visible = false, Parent = body }, {
		Kit.list(Enum.FillDirection.Horizontal, 6),
	})
	shop.slot = "jackets"
	shop.slotButtons = {}
	for i, slot in Catalog.SLOTS do
		shop.slotButtons[slot] = Kit.button({ Parent = slotRow, Text = Catalog.SLOT_NAMES[slot], Color = C.panel2, Size = UDim2.fromOffset(120, 34), TextSize = 17, LayoutOrder = i, Radius = 17 }, function()
			shop.slot = slot
			shop.render()
		end)
	end
	make("UIGridLayout", { CellSize = UDim2.fromOffset(196, 252), CellPadding = UDim2.fromOffset(14, 14), SortOrder = Enum.SortOrder.LayoutOrder, Parent = grid })
	make("UIPadding", { PaddingTop = UDim.new(0, 6), PaddingLeft = UDim.new(0, 4), PaddingRight = UDim.new(0, 12), Parent = grid })
	shop.grid = grid
	shop.tab = "outfit"
	local pick
	pick = tabs(body, {
		{ "outfit", "Outfit", 140, "player", "🧍" },
		{ "skis", "Skis", 118, "rocket", "🎿" },
		{ "boards", "Boards", 136, "board", "🏂" },
		{ "trails", "Trails", 128, "trail", "✨" },
		{ "upgrades", "Upgrades", 158, "upgrade", "⬆" },
		{ "robux", "Passes", 136, "robux", "R$" },
	}, function(id)
		shop.tab = id
		shop.render()
	end)
	shop.pick = pick
	local LISTS = { skis = Catalog.skis, boards = Catalog.boards, trails = Catalog.trails }
	function shop.render()
		if not profile then
			return
		end
		clear(grid)
		local tab = shop.tab
		local outfitTab = tab == "outfit"
		slotRow.Visible = outfitTab
		grid.Position = UDim2.fromOffset(0, if outfitTab then 104 else 62)
		grid.Size = UDim2.new(1, 0, 1, if outfitTab then -104 else -62)
		for slot, b in shop.slotButtons do
			Kit.setButtonColor(b, if slot == shop.slot then C.blue else C.panel2)
		end
		if outfitTab then
			for i, item in Catalog.outfit[shop.slot] do
				itemCard(grid, i, shop.slot, item)
			end
		elseif LISTS[tab] then
			for i, item in LISTS[tab] do
				itemCard(grid, i, tab, item)
			end
		elseif tab == "upgrades" then
			for i, u in Catalog.upgrades do
				upgradeCard(grid, i, u)
			end
		else
			local any = false
			for i, p in Catalog.passes do
				any = robuxCard(grid, i, p, true) or any
			end
			for i, p in Catalog.products do
				any = robuxCard(grid, 10 + i, p, false) or any
			end
			if not any then
				text({ Parent = grid, Text = "Coming soon!", TextSize = 28, LayoutOrder = 1 })
			end
		end
	end
	w.onOpen = function()
		shop.render()
	end
	table.insert(refreshers, function()
		if Kit.isOpen("shop") then
			shop.render()
		end
	end)
end

function Menus.openShop(tab: string)
	Kit.open("shop")
	shop.pick(tab)
end

-- ---------- daily rewards ----------
local daily = {} :: { [string]: any }
local function buildDaily()
	local w = Kit.window("daily", "DAILY REWARDS", C.blue, Vector2.new(860, 480), "gift", "🎁")
	local body = w.body
	text({ Parent = body, Text = "Come back every day! Your streak grows the reward.", Font = Kit.BODY, TextSize = 18, Size = UDim2.new(1, 0, 0, 26) })
	local row = make("Frame", { BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 40), Size = UDim2.new(1, 0, 0, 170), Parent = body }, {
		make("UIGridLayout", { CellSize = UDim2.new(1 / 7, -10, 1, 0), CellPadding = UDim2.fromOffset(10, 0), SortOrder = Enum.SortOrder.LayoutOrder, HorizontalAlignment = Enum.HorizontalAlignment.Center }),
	})
	daily.tiles = {}
	for i, coins in Catalog.daily do
		local tile = make("Frame", { BackgroundColor3 = C.panel2, LayoutOrder = i, Parent = row }, { Kit.corner(14), Kit.stroke(1.5, C.ink) })
		text({ Parent = tile, Text = "DAY " .. i, TextSize = 18, Position = UDim2.fromOffset(0, 8), Size = UDim2.new(1, 0, 0, 22) })
		local icon = if i == 7 then "chest" elseif i >= 5 then "bag" else "coin"
		Kit.icon(icon, if i == 7 then "💎" else "💰", { Parent = tile, Size = UDim2.fromOffset(60, 60), AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 32) })
		text({ Parent = tile, Text = commas(coins), TextSize = 22, TextColor3 = C.gold, Position = UDim2.fromOffset(0, 96), Size = UDim2.new(1, 0, 0, 26) })
		local check = Kit.icon("check", "✔", { Parent = tile, Size = UDim2.fromOffset(44, 44), AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 122) })
		check.Visible = false
		daily.tiles[i] = { tile = tile, check = check }
	end
	daily.status = text({ Parent = body, Text = "", TextSize = 22, Position = UDim2.fromOffset(0, 226), Size = UDim2.new(1, 0, 0, 30) })
	daily.claim = Kit.button({ Parent = body, Text = "CLAIM", Color = C.green, AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 266), Size = UDim2.fromOffset(260, 70), TextSize = 36 }, function()
		local res = action("claimDaily")
		if res and res.ok then
			Sfx.reward()
			Kit.toast("+" .. commas(res.coins) .. " coins! Day " .. res.day .. " claimed", "coins")
		end
	end)
	function daily.render()
		if not profile then
			return
		end
		local d = profile.daily
		local wait = d.wait - (os.clock() - (profile._at or os.clock()))
		local ready = d.ready or wait <= 0
		for i, t in daily.tiles do
			local isNext = i == d.nextDay
			t.check.Visible = i < d.nextDay
			local stroke = t.tile:FindFirstChildOfClass("UIStroke") :: UIStroke
			stroke.Color = if isNext and ready then C.gold else C.ink
			stroke.Thickness = if isNext and ready then 5 else 3
		end
		daily.claim.Visible = ready
		daily.status.Text = if ready then "Your Day " .. d.nextDay .. " gift is ready!" else "Next gift in " .. fmtTime(wait)
	end
	w.onOpen = daily.render
	table.insert(refreshers, daily.render)
end

-- ---------- quests ----------
local quests = {} :: { [string]: any }
local function buildQuests()
	local w = Kit.window("quests", "DAILY QUESTS", C.blue, Vector2.new(760, 500), "scroll", "📜")
	local body = w.body
	local list = make("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 1, -40), Parent = body }, { Kit.list(Enum.FillDirection.Vertical, 12) })
	quests.footer = text({ Parent = body, Text = "", Font = Kit.BODY, TextSize = 17, AnchorPoint = Vector2.new(0, 1), Position = UDim2.fromScale(0, 1), Size = UDim2.new(1, 0, 0, 26), TextColor3 = Kit.lighten(C.sky, 0.5) })
	function quests.render()
		if not profile then
			return
		end
		clear(list)
		for i, q in profile.quests do
			local done = q.progress >= q.goal
			local row = make("Frame", { BackgroundColor3 = C.panel2, Size = UDim2.new(1, 0, 0, 104), LayoutOrder = i, Parent = list }, {
				Kit.corner(16),
				Kit.stroke(if done and not q.claimed then 2.5 else 1.5, if done and not q.claimed then C.green else C.ink),
			})
			local goalText = if q.goal >= 1000 then commas(q.goal) else tostring(q.goal)
			text({ Parent = row, Text = string.format(string.gsub(q.text, "%%d", "%%s"), goalText), TextSize = 23, Position = UDim2.fromOffset(16, 10), Size = UDim2.new(1, -230, 0, 30), TextXAlignment = Enum.TextXAlignment.Left })
			local bar = Kit.bar({ Parent = row, Position = UDim2.fromOffset(16, 52), Size = UDim2.new(1, -230, 0, 30), Color = if done then C.green else C.sky, TextSize = 16 })
			bar:set(q.progress / q.goal)
			bar.label.Text = commas(q.progress) .. " / " .. commas(q.goal)
			local reward = make("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -16, 0, 8), Size = UDim2.fromOffset(190, 34), Parent = row })
			Kit.coin(28, reward, UDim2.fromOffset(40, 3))
			text({ Parent = reward, Text = commas(q.reward), TextSize = 24, TextColor3 = C.gold, Position = UDim2.fromOffset(74, 0), Size = UDim2.new(1, -74, 1, 0), TextXAlignment = Enum.TextXAlignment.Left })
			Kit.button({
				Parent = row,
				Text = if q.claimed then "CLAIMED" elseif done then "CLAIM" else "IN PROGRESS",
				Color = if q.claimed then C.grey elseif done then C.green else C.panel2,
				AnchorPoint = Vector2.new(1, 1),
				Position = UDim2.new(1, -16, 1, -14),
				Size = UDim2.fromOffset(190, 44),
				TextSize = if done and not q.claimed then 24 else 17,
			}, function()
				if done and not q.claimed then
					local res = action("claimQuest", q.slot)
					if res and res.ok then
						Sfx.reward()
						Kit.toast("Quest complete! +" .. commas(res.coins) .. " coins", "coins")
						if res.levelUp then
							Menus.levelUp(res.levelUp)
						end
					end
				end
			end)
		end
		local now = os.time()
		local secondsLeft = 86400 - (now % 86400)
		quests.footer.Text = "New quests in " .. fmtTime(secondsLeft)
	end
	w.onOpen = quests.render
	table.insert(refreshers, function()
		if Kit.isOpen("quests") then
			quests.render()
		end
	end)
end

-- ---------- codes ----------
local function buildCodes()
	local w = Kit.window("codes", "CODES", C.blue, Vector2.new(560, 380), "codes", "🎫")
	local body = w.body
	text({ Parent = body, Text = "Got a code? Type it in for free coins!", Font = Kit.BODY, TextSize = 18, Size = UDim2.new(1, 0, 0, 26) })
	local box = make("TextBox", {
		Parent = body,
		PlaceholderText = "Enter code...",
		Text = "",
		ClearTextOnFocus = false,
		Font = Kit.TITLE,
		TextSize = 30,
		TextColor3 = C.ink,
		PlaceholderColor3 = C.grey,
		BackgroundColor3 = C.white,
		Position = UDim2.fromOffset(0, 46),
		Size = UDim2.new(1, 0, 0, 64),
	}, { Kit.corner(14), Kit.stroke(3, C.ink) })
	local status = text({ Parent = body, Text = "", TextSize = 20, Position = UDim2.fromOffset(0, 120), Size = UDim2.new(1, 0, 0, 28) })
	Kit.button({ Parent = body, Text = "REDEEM", Color = C.green, AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 160), Size = UDim2.fromOffset(240, 64), TextSize = 32 }, function()
		local res = action("redeem", box.Text)
		if res and res.ok then
			Sfx.reward()
			status.Text = "+" .. commas(res.coins) .. " coins!"
			status.TextColor3 = C.green
			Kit.toast("Code redeemed! +" .. commas(res.coins) .. " coins", "coins")
			box.Text = ""
		elseif res then
			status.Text = res.msg or "Invalid code"
			status.TextColor3 = C.red
		end
	end)
	text({ Parent = body, Text = "Tip: try PEAKFLIP", Font = Kit.BODY, TextSize = 15, AnchorPoint = Vector2.new(0, 1), Position = UDim2.fromScale(0, 1), Size = UDim2.new(1, 0, 0, 22), TextColor3 = Kit.lighten(C.sky, 0.5) })
end

-- ---------- stats ----------
local stats = {} :: { [string]: any }
local function buildStats()
	local w = Kit.window("stats", "YOUR STATS", C.blue, Vector2.new(760, 520), "stats", "📊")
	local grid = make("Frame", { BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Parent = w.body }, {
		make("UIGridLayout", { CellSize = UDim2.new(1 / 3, -12, 0, 100), CellPadding = UDim2.fromOffset(12, 12), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	function stats.render()
		if not profile then
			return
		end
		clear(grid)
		local s = profile.stats
		local entries = {
			{ "trophy", "🏆", "Best score", commas(profile.best) },
			{ "star", "⭐", "Level", tostring(profile.level) },
			{ "board", "🎿", "Runs", commas(profile.runs) },
			{ "target", "📏", "Distance", commas(s.dist) .. " m" },
			{ "lightning", "🤸", "Flips", commas(s.flips) },
			{ "medal", "✨", "Perfect landings", commas(s.perfects) },
			{ "shield", "🛤️", "Rail grinds", commas(s.grinds) },
			{ "rocket", "🦘", "Trampoline bounces", commas(s.bounces) },
			{ "clock", "⏱️", "Time riding", fmtTime(s.playSeconds) },
		}
		for i, e in entries do
			local tile = make("Frame", { BackgroundColor3 = C.panel2, LayoutOrder = i, Parent = grid }, { Kit.corner(14), Kit.stroke(1.5, C.ink) })
			Kit.icon(e[1], e[2], { Parent = tile, Size = UDim2.fromOffset(60, 60), AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.new(0, 6, 0.5, 0) })
			text({ Parent = tile, Text = e[3], Font = Kit.BODY, TextSize = 15, Position = UDim2.fromOffset(72, 18), Size = UDim2.new(1, -80, 0, 20), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = Kit.lighten(C.sky, 0.5), Outline = 1 })
			text({ Parent = tile, Text = e[4], TextSize = 28, Position = UDim2.fromOffset(72, 42), Size = UDim2.new(1, -80, 0, 34), TextXAlignment = Enum.TextXAlignment.Left, TextScaled = true })
		end
	end
	w.onOpen = stats.render
end

-- ---------- leaderboard ----------
local board = {} :: { [string]: any }
local function renderRows(list: Frame, rows)
	clear(list)
	if not rows then
		text({ Parent = list, Text = "Loading...", TextSize = 22, Size = UDim2.new(1, 0, 0, 40) })
		return
	end
	if #rows == 0 then
		text({ Parent = list, Text = "No scores yet. Be the first!", TextSize = 22, Size = UDim2.new(1, 0, 0, 40) })
		return
	end
	for i, row in rows do
		local mine = row.userId == player.UserId
		local f = make("Frame", { BackgroundColor3 = if mine then C.gold else C.white, BackgroundTransparency = if mine then 0.2 else 0.9, Size = UDim2.new(1, -10, 0, 40), LayoutOrder = i, Parent = list }, { Kit.corner(10) })
		if i == 1 then
			Kit.icon("crown", "👑", { Parent = f, Size = UDim2.fromOffset(40, 40), Position = UDim2.fromOffset(8, 0) })
		elseif i <= 3 then
			Kit.icon("medal", if i == 2 then "🥈" else "🥉", { Parent = f, Size = UDim2.fromOffset(38, 38), Position = UDim2.fromOffset(9, 1) })
		else
			text({ Parent = f, Text = "#" .. i, TextSize = 22, Size = UDim2.fromOffset(56, 40) })
		end
		text({ Parent = f, Text = row.name, TextSize = 22, Position = UDim2.fromOffset(60, 0), Size = UDim2.new(1, -220, 1, 0), TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd })
		text({ Parent = f, Text = commas(row.score), TextSize = 22, TextColor3 = if mine then C.white else C.gold, AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -12, 0, 0), Size = UDim2.fromOffset(150, 40), TextXAlignment = Enum.TextXAlignment.Right })
	end
end
local function buildLeaderboard()
	local w = Kit.window("leaderboard", "LEADERBOARD", C.blue, Vector2.new(640, 620), "trophy", "🏆")
	local list = scroller(w.body, { Position = UDim2.fromOffset(0, 62), Size = UDim2.new(1, 0, 1, -62) })
	Kit.list(Enum.FillDirection.Vertical, 6).Parent = list
	board.tab = "allTime"
	board.pick = tabs(w.body, { { "allTime", "All time", 170, "crown", "👑" }, { "daily", "Today", 150, "calendar", "📅" } }, function(id)
		board.tab = id
		renderRows(list, boards[id])
	end)
	w.onOpen = function()
		board.pick(board.tab)
		cb.onRefreshBoards()
	end
	board.render = function()
		renderRows(list, boards[board.tab])
	end
end

-- ---------- settings ----------
local settings = {} :: { [string]: any }
local function buildSettings()
	local w = Kit.window("settings", "SETTINGS", C.grey, Vector2.new(620, 580), "settings", "⚙️")
	local list = make("Frame", { BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Parent = w.body }, { Kit.list(Enum.FillDirection.Vertical, 12) })
	local function row(order: number, label: string, icon: string, emoji: string)
		local f = make("Frame", { BackgroundColor3 = C.panel2, Size = UDim2.new(1, 0, 0, 64), LayoutOrder = order, Parent = list }, { Kit.corner(14), Kit.stroke(1.5, C.ink) })
		Kit.icon(icon, emoji, { Parent = f, Size = UDim2.fromOffset(52, 52), AnchorPoint = Vector2.new(0, 0), Position = UDim2.fromOffset(8, 6) })
		text({ Parent = f, Text = label, TextSize = 24, Position = UDim2.fromOffset(70, 0), Size = UDim2.new(0.5, 0, 0, 64), TextXAlignment = Enum.TextXAlignment.Left })
		return f
	end
	settings.toggles = {}
	for i, t in { { "music", "Music", "musicOn", "🎵" }, { "sfx", "Sound effects", "soundOn", "🔊" }, { "hints", "Controls hint", "info", "💡" }, { "lowGfx", "Low graphics", "lightning", "🌲" } } do
		local f = row(i, t[2], t[3], t[4])
		local holder = Kit.button({ Parent = f, Text = "ON", Color = C.green, AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -14, 0.5, -2), Size = UDim2.fromOffset(110, 46), TextSize = 22 }, function()
			local s = profile.settings
			s[t[1]] = not s[t[1]]
			settings.render()
			cb.onSettings(s)
		end)
		settings.toggles[t[1]] = holder
	end
	local camRow = row(5, "Camera", "target", "🎥")
	camRow.Size = UDim2.new(1, 0, 0, 112)
	local cams = make("Frame", { BackgroundTransparency = 1, Position = UDim2.fromOffset(14, 56), Size = UDim2.new(1, -28, 0, 44), Parent = camRow }, { Kit.list(Enum.FillDirection.Horizontal, 8) })
	settings.cams = {}
	for i, v in { { "chase", "Chase" }, { "high", "High" }, { "first", "First" }, { "side", "Side" } } do
		settings.cams[v[1]] = Kit.button({ Parent = cams, Text = v[2], Color = C.panel2, Size = UDim2.new(0.25, -6, 1, 0), TextSize = 20, LayoutOrder = i }, function()
			profile.settings.view = v[1]
			settings.render()
			cb.onSettings(profile.settings)
		end)
	end
	function settings.render()
		if not profile then
			return
		end
		for key, holder in settings.toggles do
			local on = profile.settings[key]
			Kit.setButtonColor(holder, if on then C.green else C.red);
			(holder:FindFirstChild("Face") :: TextButton).Text = if on then "ON" else "OFF"
		end
		for key, holder in settings.cams do
			Kit.setButtonColor(holder, if profile.settings.view == key then C.blue else C.panel2)
		end
	end
	w.onOpen = settings.render
end

-- ---------- results ----------
local res = {} :: { [string]: any }
local function buildResults(gui: ScreenGui)
	local root = make("Frame", { Name = "Results", BackgroundColor3 = C.ink, BackgroundTransparency = 0.35, Size = UDim2.fromScale(1, 1), Visible = false, ZIndex = 25, Parent = gui })
	res.root = root
	root.BackgroundTransparency = 0.25
	local col = make("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.53), Size = UDim2.fromOffset(560, 640), Parent = root }, {
		Kit.list(Enum.FillDirection.Vertical, 10, Enum.HorizontalAlignment.Center),
	})
	res.scale = make("UIScale", { Parent = col })
	res.title = text({ Parent = col, Text = "RUN OVER", TextSize = 54, Size = UDim2.new(1, 0, 0, 60), Outline = 3, LayoutOrder = 1 })
	res.reason = text({ Parent = col, Text = "", Font = Kit.BODY, TextSize = 20, Size = UDim2.new(1, 0, 0, 24), LayoutOrder = 2 })
	res.score = text({ Parent = col, Text = "0", TextSize = 88, Size = UDim2.new(1, 0, 0, 90), Outline = 6, LayoutOrder = 3 })
	res.best = text({ Parent = col, Text = "NEW BEST", TextSize = 24, TextColor3 = C.gold, Size = UDim2.new(1, 0, 0, 28), Visible = false, LayoutOrder = 4, Outline = 2 })
	res.bestScale = make("UIScale", { Parent = res.best })
	res.dist = text({ Parent = col, Text = "", TextSize = 22, TextColor3 = Kit.lighten(C.sky, 0.5), Size = UDim2.new(1, 0, 0, 26), LayoutOrder = 5 })

	local card = make("Frame", { BackgroundColor3 = C.panel, Size = UDim2.new(1, 0, 0, 176), LayoutOrder = 6, Parent = col }, {
		Kit.corner(18),
		Kit.stroke(1.5, C.ink),
		Kit.padding(14),
	})
	local lines = make("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 96), Parent = card }, { Kit.list(Enum.FillDirection.Vertical, 2) })
	res.lines = lines
	local total = make("Frame", { BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 96), Size = UDim2.new(1, 0, 0, 52), Parent = card })
	Kit.coin(44, total, UDim2.fromOffset(0, 4))
	res.earned = text({ Parent = total, Text = "+0", TextSize = 42, TextColor3 = C.gold, Position = UDim2.fromOffset(54, 0), Size = UDim2.new(0.5, 0, 1, 0), TextXAlignment = Enum.TextXAlignment.Left, Outline = 3 })
	res.xpText = text({ Parent = total, Text = "", TextSize = 22, TextColor3 = Kit.lighten(C.blue, 0.4), AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, 0, 0, 0), Size = UDim2.new(0.45, 0, 1, 0), TextXAlignment = Enum.TextXAlignment.Right })

	res.xp = Kit.bar({ Parent = col, Size = UDim2.new(1, 0, 0, 30), Color = C.blue, TextSize = 16, LayoutOrder = 7 })
	res.quests = text({ Parent = col, Text = "", TextSize = 19, TextColor3 = C.green, Size = UDim2.new(1, 0, 0, 24), TextWrapped = true, LayoutOrder = 8 })

	local buttons = make("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 84), LayoutOrder = 9, Parent = col }, { Kit.list(Enum.FillDirection.Horizontal, 14, Enum.HorizontalAlignment.Center) })
	Kit.button({ Parent = buttons, Text = "▶  PLAY AGAIN", Color = C.green, Size = UDim2.new(0.6, -7, 1, -6), TextSize = 34, LayoutOrder = 1 }, function()
		cb.onAgain()
	end)
	Kit.button({ Parent = buttons, Text = "LOBBY", Color = C.blue, Size = UDim2.new(0.4, -7, 1, -6), TextSize = 30, LayoutOrder = 2 }, function()
		cb.onLobby()
	end)
end

local function resultLine(label: string, value: string, color: Color3?)
	local f = make("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 30), Parent = res.lines })
	text({ Parent = f, Text = label, Font = Kit.BODY, TextSize = 19, Size = UDim2.new(0.7, 0, 1, 0), TextXAlignment = Enum.TextXAlignment.Left, Outline = 1 })
	text({ Parent = f, Text = value, TextSize = 22, TextColor3 = color or C.gold, AnchorPoint = Vector2.new(1, 0), Position = UDim2.fromScale(1, 0), Size = UDim2.new(0.3, 0, 1, 0), TextXAlignment = Enum.TextXAlignment.Right })
end

-- data: { score, dist, coins, reason } from the client right away
function Menus.showResults(data)
	res.root.Visible = true
	res.scale.Scale = 0.5
	tween(res.scale, 0.4, { Scale = 1 }, Enum.EasingStyle.Back)
	res.title.Text = ({ "RUN OVER", "NICE RUN", "SO CLOSE" })[math.random(1, 3)]
	res.reason.Text = data.reason
	res.best.Visible = false
	res.dist.Text = commas(data.dist) .. " m  •  " .. data.coins .. " coins grabbed"
	Kit.countUp(res.score, data.score, 1.2, commas)
	clear(res.lines)
	resultLine("Coins collected", "...")
	res.earned.Text = "+..."
	res.xpText.Text = ""
	res.quests.Text = ""
	if profile then
		res.xp:set(profile.xpInto / profile.xpNeed)
		res.xp.label.Text = "Level " .. profile.level
	end
end

-- rewards arrive from the server a moment later
function Menus.setRewards(r)
	if not r then
		clear(res.lines)
		resultLine("Couldn't reach the server", "", C.red)
		return
	end
	clear(res.lines)
	resultLine("Coins collected", "+" .. commas(r.collected))
	resultLine("Score bonus", "+" .. commas(r.bonus))
	if r.doubled then
		resultLine("2x Coins pass", "x2", C.green)
	end
	Kit.countUp(res.earned, r.earned, 1, function(n)
		return "+" .. commas(n)
	end)
	res.xpText.Text = "+" .. commas(r.xp) .. " XP"
	if r.newBest then
		res.best.Visible = true
		res.bestScale.Scale = 2
		tween(res.bestScale, 0.5, { Scale = 1 }, Enum.EasingStyle.Elastic)
		Sfx.reward()
	end
	if #r.quests > 0 then
		res.quests.Text = "Quest done: " .. table.concat(r.quests, ", ") .. "  (claim it in Quests)"
	end
	if r.levelUp then
		task.delay(0.8, Menus.levelUp, r.levelUp)
	end
end

function Menus.hideResults()
	res.root.Visible = false
end

function Menus.levelUp(level: number)
	Sfx.reward()
	Kit.toast("⭐ LEVEL UP! You're level " .. level .. "!", "level")
end

-- ---------- public ----------
function Menus.init(gui: ScreenGui, callbacks)
	cb = callbacks
	buildLobby(gui)
	buildShop()
	buildDaily()
	buildQuests()
	buildCodes()
	buildStats()
	buildLeaderboard()
	buildSettings()
	buildResults(gui)
	-- daily countdown and other timers
	task.spawn(function()
		while true do
			task.wait(1)
			if Kit.isOpen("daily") then
				daily.render()
			end
			if Kit.isOpen("quests") then
				local now = os.time()
				quests.footer.Text = "New quests in " .. fmtTime(86400 - (now % 86400))
			end
			Menus.updateDots()
		end
	end)
end

function Menus.updateDots()
	if not profile then
		return
	end
	local d = profile.daily
	local wait = d.wait - (os.clock() - (profile._at or os.clock()))
	lobby.dots.daily.Visible = d.ready or wait <= 0
	local claimable = false
	for _, q in profile.quests do
		if q.progress >= q.goal and not q.claimed then
			claimable = true
		end
	end
	lobby.dots.quests.Visible = claimable
end

local lastCoins = -1
function Menus.setProfile(p)
	if not p then
		return
	end
	p._at = os.clock()
	profile = p
	lobby.level.Text = tostring(p.level)
	lobby.xp:set(p.xpInto / p.xpNeed, true)
	lobby.xp.label.Text = commas(p.xpInto) .. " / " .. commas(p.xpNeed) .. " XP"
	if p.coins ~= lastCoins then
		if lastCoins >= 0 and p.coins > lastCoins then
			lobby.coinScale.Scale = 1.2
			tween(lobby.coinScale, 0.3, { Scale = 1 }, Enum.EasingStyle.Back)
		end
		lastCoins = p.coins
		Kit.countUp(lobby.coins, p.coins, 0.5, commas)
	end
	local ski = Catalog.find(Catalog.skis, p.equipped.skis)
	local deck = Catalog.find(Catalog.boards, p.equipped.boards)
	local gearName = if p.equipped.gear == "board" then (if deck then deck.name else "") else (if ski then ski.name else "")
	lobby.best.Text = "Best " .. commas(p.best) .. "   •   " .. gearName
	for key, b in lobby.gear do
		Kit.setButtonColor(b, if p.equipped.gear == key then C.blue else C.panel2)
	end
	Menus.updateDots()
	for _, fn in refreshers do
		fn()
	end
	if Kit.isOpen("settings") then
		settings.render()
	end
	if Kit.isOpen("stats") then
		stats.render()
	end
end

function Menus.setBoards(data)
	boards = data or {}
	if board.render then
		board.render()
	end
end

function Menus.showLobby(on: boolean)
	lobby.root.Visible = on
	if not on then
		Kit.closeAll()
	end
end

function Menus.profile()
	return profile
end

return Menus
