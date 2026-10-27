-- The in-run HUD: score, distance, coins, combo, trick pop-ups, speed, countdown, revive and pause.
local TweenService = game:GetService("TweenService")

local Kit = require(script.Parent.Kit)
local Sfx = require(script.Parent.Parent.Sfx)
local Util = require(script.Parent.Parent.Util)

local C, make, text = Kit.C, Kit.make, Kit.text
local commas = Util.commas

local Hud = {}
local h = {} :: { [string]: any }
local cb = {} :: { [string]: any }

local function tween(o: Instance, t: number, goal, style: Enum.EasingStyle?, dir: Enum.EasingDirection?)
	local tw = TweenService:Create(o, TweenInfo.new(t, style or Enum.EasingStyle.Quad, dir or Enum.EasingDirection.Out), goal)
	tw:Play()
	return tw
end

function Hud.init(gui: ScreenGui, callbacks, isTouch: boolean)
	cb = callbacks
	local root = make("Frame", { Name = "Hud", BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Visible = false, Parent = gui })
	h.root = root

	-- score + distance, top centre
	local top = make("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 50), Size = UDim2.fromOffset(420, 110), Parent = root })
	h.score = text({ Parent = top, Text = "0", TextSize = 60, Size = UDim2.new(1, 0, 0, 62), Outline = 4 })
	h.scoreScale = make("UIScale", { Parent = h.score })
	h.dist = text({ Parent = top, Text = "0 m", Font = Kit.BODY, TextSize = 22, TextColor3 = C.white, Position = UDim2.fromOffset(0, 62), Size = UDim2.new(1, 0, 0, 24), Outline = 2 })
	h.bestTag = text({ Parent = top, Text = "NEW BEST!", TextSize = 20, TextColor3 = C.gold, Position = UDim2.fromOffset(0, 86), Size = UDim2.new(1, 0, 0, 22), Visible = false, Outline = 2 })

	-- combo
	h.combo = make("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 165), Size = UDim2.fromOffset(300, 54), Visible = false, Parent = root })
	h.comboText = text({ Parent = h.combo, Text = "", TextSize = 30, TextColor3 = C.gold, Size = UDim2.new(1, 0, 0, 34), Outline = 3 })
	h.comboScale = make("UIScale", { Parent = h.comboText })
	h.comboBar = Kit.bar({ Parent = h.combo, Size = UDim2.new(0.8, 0, 0, 12), Position = UDim2.new(0.1, 0, 0, 38), Color = C.gold })

	-- coins, top right (below the Roblox top bar)
	local coins = make("Frame", { BackgroundColor3 = C.ink, BackgroundTransparency = 0.25, AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -16, 0, 64), Size = UDim2.fromOffset(150, 50), Parent = root }, { Kit.round(), Kit.stroke(3, C.ink) })
	Kit.coin(38, coins, UDim2.fromOffset(6, 6))
	h.coins = text({ Parent = coins, Text = "0", TextSize = 30, Position = UDim2.fromOffset(52, 0), Size = UDim2.new(1, -60, 1, 0), TextXAlignment = Enum.TextXAlignment.Left })
	h.coinScale = make("UIScale", { Parent = coins })

	-- pause button
	Kit.button({ Parent = root, Text = "II", Color = C.blue, AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -176, 0, 64), Size = UDim2.fromOffset(50, 50), TextSize = 24, Radius = 25 }, function()
		cb.onPause()
	end)

	-- speed, bottom right
	local speed = make("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(1, 1), Position = UDim2.new(1, -20, 1, -20), Size = UDim2.fromOffset(200, 70), Parent = root })
	h.speed = text({ Parent = speed, Text = "0", TextSize = 46, Size = UDim2.new(1, 0, 0, 48), TextXAlignment = Enum.TextXAlignment.Right, Outline = 3 })
	text({ Parent = speed, Text = "KM/H", TextSize = 16, Position = UDim2.fromOffset(0, 46), Size = UDim2.new(1, 0, 0, 18), TextXAlignment = Enum.TextXAlignment.Right, Outline = 2 })
	h.speedBar = Kit.bar({ Parent = root, AnchorPoint = Vector2.new(1, 1), Position = UDim2.new(1, -20, 1, -94), Size = UDim2.fromOffset(200, 10), Color = C.blue })

	-- trick feed: small lines stacking up from the bottom of the screen, out of the way of the slope
	h.feed = make("Frame", { Name = "TrickFeed", BackgroundTransparency = 1, AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -118), Size = UDim2.fromOffset(640, 130), Parent = root }, {
		Kit.list(Enum.FillDirection.Vertical, 2, Enum.HorizontalAlignment.Center, Enum.VerticalAlignment.Bottom),
	})

	-- controls hint
	h.hint = text({
		Parent = root,
		Text = if isTouch
			then "Drag to steer  •  Tap to jump\nIn the air: drag up/down to flip, sideways to spin, hold still to grab"
			else "A / D steer  •  SPACE jump\nIn the air: W / S flip  •  A / D spin  •  both = sideflip  •  hold SHIFT to grab, G switches grab\nC camera  •  P pause",
		TextSize = 19,
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -24),
		Size = UDim2.new(0.8, 0, 0, 80),
		TextWrapped = true,
		Visible = false,
		Outline = 2,
	})

	-- countdown
	h.count = text({ Parent = gui, Text = "", TextSize = 160, AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.42), Size = UDim2.fromOffset(500, 180), Outline = 8, Visible = false, ZIndex = 40 })
	h.countScale = make("UIScale", { Parent = h.count })

	-- revive offer: a clean card in the middle of the screen
	local rev = make("Frame", { Name = "Revive", BackgroundColor3 = C.panel, AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(360, 270), Visible = false, ZIndex = 40, Parent = gui }, {
		Kit.corner(20),
		Kit.stroke(2, C.ink),
	})
	h.revive = rev
	h.reviveScale = make("UIScale", { Parent = rev })
	text({ Parent = rev, Text = "Keep going?", TextSize = 40, Position = UDim2.fromOffset(0, 16), Size = UDim2.new(1, 0, 0, 46), ZIndex = 41 })
	h.reviveReason = text({ Parent = rev, Text = "", Font = Kit.BODY, TextSize = 17, TextColor3 = C.sky, Position = UDim2.fromOffset(0, 62), Size = UDim2.new(1, 0, 0, 24), ZIndex = 41, Outline = 1 })
	h.reviveFree = Kit.button({ Parent = rev, Text = "FREE REVIVE", Icon = "heart", IconFallback = "❤", Color = C.green, Position = UDim2.fromOffset(30, 100), Size = UDim2.new(1, -60, 0, 64), TextSize = 28 }, function()
		cb.onRevive(true)
	end)
	local robux, robuxFace = Kit.button({ Parent = rev, Text = "REVIVE", Icon = "robux", IconFallback = "R$", Color = C.green, Position = UDim2.fromOffset(30, 100), Size = UDim2.new(1, -60, 0, 64), TextSize = 28 }, function()
		cb.onRevive(true)
	end)
	h.reviveRobux, h.reviveRobuxFace = robux, robuxFace
	h.reviveTimer = Kit.bar({ Parent = rev, Position = UDim2.fromOffset(30, 180), Size = UDim2.new(1, -60, 0, 10), Color = C.gold })
	h.reviveWait = text({ Parent = rev, Text = "Finishing your purchase...", Font = Kit.BODY, TextSize = 16, Position = UDim2.fromOffset(0, 176), Size = UDim2.new(1, 0, 0, 20), ZIndex = 41, Visible = false, Outline = 1 })
	local no = make("TextButton", { Parent = rev, Text = "No thanks", Font = Kit.BODY, TextSize = 18, TextColor3 = C.sky, BackgroundTransparency = 1, Position = UDim2.fromOffset(30, 206), Size = UDim2.new(1, -60, 0, 40), ZIndex = 41 })
	no.Activated:Connect(function()
		Sfx.click()
		cb.onRevive(false)
	end)

	-- pause menu
	local pause = make("Frame", { Name = "Pause", BackgroundColor3 = Color3.new(0, 0, 0), BackgroundTransparency = 0.45, Size = UDim2.fromScale(1, 1), Visible = false, ZIndex = 45, Parent = gui })
	h.pause = pause
	local col = make("Frame", { BackgroundTransparency = 1, AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(300, 330), Parent = pause }, { Kit.list(Enum.FillDirection.Vertical, 16, Enum.HorizontalAlignment.Center) })
	text({ Parent = col, Text = "PAUSED", TextSize = 64, Size = UDim2.new(1, 0, 0, 74), Outline = 5, LayoutOrder = 1 })
	Kit.button({ Parent = col, Text = "Resume", Color = C.green, Size = UDim2.new(1, 0, 0, 64), TextSize = 30, LayoutOrder = 2 }, function()
		cb.onPause()
	end)
	Kit.button({ Parent = col, Text = "Settings", Color = C.blue, Size = UDim2.new(1, 0, 0, 56), TextSize = 26, LayoutOrder = 3 }, function()
		cb.onSettings()
	end)
	Kit.button({ Parent = col, Text = "Back to lobby", Color = C.red, Size = UDim2.new(1, 0, 0, 56), TextSize = 26, LayoutOrder = 4 }, function()
		cb.onQuit()
	end)

	-- full-screen flash for transitions
	h.flash = make("Frame", { Name = "Flash", BackgroundColor3 = C.white, BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), ZIndex = 90, Parent = gui })
end

local function clearFeed()
	for _, c in h.feed:GetChildren() do
		if c:IsA("GuiObject") then
			c:Destroy()
		end
	end
end

function Hud.show(on: boolean, hint: boolean?)
	h.root.Visible = on
	if on then
		clearFeed()
		h.bestTag.Visible = false
		h.passedBest = false
		h.combo.Visible = false
		h.hint.Visible = hint == true
		Kit.unfade(h.hint)
		if hint then
			task.delay(9, function()
				Kit.fade(h.hint, 1)
			end)
		end
	end
end

local last = { score = -1, coins = -1, dist = -1 }
function Hud.reset()
	last = { score = -1, coins = -1, dist = -1 }
end

function Hud.setScore(n: number, best: number)
	if n ~= last.score then
		local jump = n - last.score
		last.score = n
		h.score.Text = commas(n)
		if jump >= 100 then
			h.scoreScale.Scale = 1.15
			tween(h.scoreScale, 0.25, { Scale = 1 })
		end
		-- "NEW BEST!" flashes up once when you pass your best, then gets out of the way
		if best > 0 and n > best and not h.passedBest then
			h.passedBest = true
			h.bestTag.Visible = true
			Kit.unfade(h.bestTag)
			task.delay(2.5, function()
				Kit.fade(h.bestTag, 0.4)
			end)
		end
	end
end

function Hud.setCoins(n: number)
	if n ~= last.coins then
		if last.coins >= 0 then
			h.coinScale.Scale = 1.2
			tween(h.coinScale, 0.2, { Scale = 1 })
		end
		last.coins = n
		h.coins.Text = commas(n)
	end
end

function Hud.setDistance(m: number)
	if m ~= last.dist then
		last.dist = m
		h.dist.Text = commas(m) .. " m"
	end
end

function Hud.setSpeed(kmh: number, frac: number)
	h.speed.Text = tostring(kmh)
	h.speedBar:set(frac)
	h.speed.TextColor3 = if frac > 0.85 then C.red elseif frac > 0.6 then C.gold else C.white
end

local lastMult = 0
function Hud.setCombo(show: boolean, mult: number, total: number, frac: number)
	h.combo.Visible = show
	if show then
		h.comboText.Text = string.format("x%s COMBO  %s", tostring(mult), commas(total))
		h.comboBar:set(frac)
		if mult ~= lastMult then
			h.comboScale.Scale = 1.3
			tween(h.comboScale, 0.25, { Scale = 1 }, Enum.EasingStyle.Back)
		end
		h.comboText.TextColor3 = C.gold
	end
	lastMult = if show then mult else 0
end

local feedOrder = 0
local MAX_LINES = 3
-- A trick (or message) in the feed: pops in, then fades out completely and removes itself.
function Hud.trick(name: string, pts: string, perfect: boolean?)
	feedOrder += 1
	local lines = {}
	for _, c in h.feed:GetChildren() do
		if c:IsA("TextLabel") then
			table.insert(lines, c)
		end
	end
	table.sort(lines, function(a, b)
		return a.LayoutOrder < b.LayoutOrder
	end)
	for i = 1, #lines - MAX_LINES + 1 do
		lines[i]:Destroy()
	end
	local color = if perfect then "#ffd23f" else "#ffffff"
	local body = string.format('<font color="%s">%s</font>', color, name)
	if pts ~= "" then
		body ..= string.format('  <font color="#7df9a8">%s</font>', pts)
	end
	local line = text({
		Parent = h.feed,
		Text = body,
		RichText = true,
		TextSize = if perfect then 30 else 26,
		Size = UDim2.new(1, 0, 0, if perfect then 36 else 32),
		LayoutOrder = feedOrder,
		Outline = 3,
	})
	local scale = make("UIScale", { Scale = 1.4, Parent = line })
	tween(scale, 0.25, { Scale = 1 }, Enum.EasingStyle.Back)
	task.delay(1.6, function()
		if line.Parent then
			Kit.fade(line, 0.35)
			task.wait(0.4)
			line:Destroy()
		end
	end)
end

-- 3, 2, 1, GO!
function Hud.countdown(onDone: () -> ())
	h.count.Visible = true
	task.spawn(function()
		for i, s in { "3", "2", "1", "GO!" } do
			h.count.Text = s
			h.count.TextColor3 = if i == 4 then C.green else C.white
			Kit.unfade(h.count)
			h.countScale.Scale = 2
			tween(h.countScale, 0.35, { Scale = 1 }, Enum.EasingStyle.Back)
			Sfx.beep(i == 4)
			if i == 4 then
				onDone()
				task.wait(0.35)
				Kit.fade(h.count, 0.3)
				task.wait(0.3)
			else
				task.wait(0.65)
			end
		end
		h.count.Visible = false
	end)
end

-- After a crash: clear everything that would sit on top of the revive card or the results.
function Hud.onCrash()
	clearFeed()
	h.combo.Visible = false
	h.bestTag.Visible = false
	h.hint.Visible = false
end

local reviveToken = 0
-- Offer a revive. mode: "free" (VIP or one already bought) or "robux" (priceText like "25").
-- Calls cb.onRevive(false) itself if time runs out.
function Hud.showRevive(reason: string, mode: string, priceText: string?, seconds: number)
	reviveToken += 1
	local token = reviveToken
	h.reviveReason.Text = reason
	h.reviveFree.Visible = mode == "free"
	h.reviveRobux.Visible = mode == "robux"
	h.reviveRobuxFace.Text = "REVIVE  " .. (priceText or "")
	h.reviveTimer.frame.Visible = true
	h.reviveWait.Visible = false
	h.revive.Visible = true
	h.reviveScale.Scale = 0.5
	tween(h.reviveScale, 0.3, { Scale = 1 }, Enum.EasingStyle.Back)
	h.reviveTimer:set(1)
	h.reviveTween = tween(h.reviveTimer.fill, seconds, { Size = UDim2.fromScale(0, 1) }, Enum.EasingStyle.Linear)
	task.delay(seconds, function()
		if token == reviveToken and h.revive.Visible then
			cb.onRevive(false)
		end
	end)
end

-- the Robux prompt is open: stop the clock until it's answered
function Hud.waitForPurchase()
	reviveToken += 1
	if h.reviveTween then
		h.reviveTween:Cancel()
	end
	h.reviveTimer.frame.Visible = false
	h.reviveWait.Visible = true
end

function Hud.hideRevive()
	reviveToken += 1
	h.revive.Visible = false
end

function Hud.showPause(on: boolean)
	h.pause.Visible = on
end

function Hud.flash(color: Color3?, duration: number?)
	h.flash.BackgroundColor3 = color or C.white
	h.flash.BackgroundTransparency = 0
	tween(h.flash, duration or 0.8, { BackgroundTransparency = 1 })
end

-- cover the screen (fade to colour); returns once covered
function Hud.cover(color: Color3?)
	h.flash.BackgroundColor3 = color or C.white
	tween(h.flash, 0.25, { BackgroundTransparency = 0 })
	task.wait(0.27)
end

return Hud
