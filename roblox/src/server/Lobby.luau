-- The shared lobby: an open-air base camp on a snowy plateau under big low-poly mountains. You spawn
-- on a round plaza facing the START GATE (walk up the ramp and through it to ride). Around the plaza:
-- the ski shop cabin with outfits on turning pedestals (west), the leaderboards (east), the daily gift
-- (south-east), and a campfire with log benches and a decorated tree (south). Every spot has a
-- floating label, and paths lead to each from the plaza. Built by the server so everyone sees the
-- same thing; clients react to the prompts by name and animate anything tagged "Flicker" or "Turntable".
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("PeakFlip")
local Config = require(Shared:WaitForChild("Config"))
local Catalog = require(Shared:WaitForChild("Catalog"))
local Outfit = require(Shared:WaitForChild("Outfit"))
local Theme = require(Shared:WaitForChild("Theme"))

local hex = Color3.fromHex
local O = Config.LOBBY_ORIGIN

local Lobby = {}

local folder: Folder
local boardLabels = {} :: { [string]: { TextLabel } }

local PLAZA_R = 30 -- radius of the plaza
local BOUND_R = 92 -- invisible fence

-- a handful of flat colours for the whole camp
local C = {
	snow = Theme.snow,
	snowShade = Theme.snowShade,
	plaza = hex("e3e8ee"),
	plazaRing = hex("cfd8e2"),
	path = hex("d6dee7"),
	wood = Theme.wood,
	woodDark = Theme.woodDark,
	roof = hex("c8473b"),
	rock = hex("8d9bab"),
	rockDark = hex("6f7d8e"),
	pine = hex("2f6b4f"),
	pineDark = hex("27573f"),
	gold = Theme.gold,
	warm = Theme.warmLight,
	blue = Theme.primary,
	panel = Theme.panel,
	ink = Theme.ink,
	white = Color3.new(1, 1, 1),
}

local function part(props): BasePart
	local p = Instance.new(props.class or "Part") :: BasePart
	props.class = nil
	p.Anchored = true
	p.TopSurface, p.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
	for k, v in props do
		if k ~= "Parent" then
			(p :: any)[k] = v
		end
	end
	if p.Material ~= Enum.Material.Neon then
		p.Material = Enum.Material.SmoothPlastic
	end
	p.Parent = props.Parent or folder
	return p
end

local function at(x: number, y: number, z: number): CFrame
	return CFrame.new(O + Vector3.new(x, y, z))
end

-- a flat disc (a cylinder standing up)
local function disc(cf: CFrame, radius: number, height: number, color: Color3, props: { [string]: any }?): BasePart
	local p = { Shape = Enum.PartType.Cylinder, Size = Vector3.new(height, radius * 2, radius * 2), CFrame = cf * CFrame.Angles(0, 0, math.pi / 2), Color = color }
	for k, v in props or {} do
		p[k] = v
	end
	return part(p)
end

local function light(parent: Instance, color: Color3, range: number, brightness: number, flicker: boolean?)
	local l = Instance.new("PointLight")
	l.Color = color
	l.Range = range
	l.Brightness = brightness
	l.Shadows = false
	l.Parent = parent
	if flicker then
		CollectionService:AddTag(l, "Flicker")
	end
	return l
end

local function sign(parent: BasePart, face: Enum.NormalId, text: string, color: Color3)
	local gui = Instance.new("SurfaceGui")
	gui.Face = face
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 40
	gui.LightInfluence = 0
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Size = UDim2.fromScale(1, 1)
	l.Font = Enum.Font.BuilderSansExtraBold
	l.Text = text
	l.TextColor3 = color
	l.TextScaled = true
	local pad = Instance.new("UIPadding")
	pad.PaddingTop, pad.PaddingBottom = UDim.new(0.12, 0), UDim.new(0.12, 0)
	pad.Parent = l
	l.Parent = gui
	gui.Parent = parent
	return l
end

-- A floating label over a spot in the camp: a flat pill with an emoji and a name, readable from
-- across the plaza so new players see where everything is.
local function label(cf: CFrame, emoji: string, text: string, color: Color3)
	local anchor = part({ Size = Vector3.one * 0.2, CFrame = cf, Transparency = 1, CanCollide = false, CanQuery = false, CanTouch = false })
	local g = Instance.new("BillboardGui")
	g.Size = UDim2.fromOffset(220, 46)
	g.LightInfluence = 0
	g.MaxDistance = 220
	g.Parent = anchor
	local pill = Instance.new("Frame")
	pill.AnchorPoint = Vector2.new(0.5, 0.5)
	pill.Position = UDim2.fromScale(0.5, 0.5)
	pill.Size = UDim2.fromScale(0, 1)
	pill.AutomaticSize = Enum.AutomaticSize.X
	pill.BackgroundColor3 = color
	pill.Parent = g
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(1, 0)
	corner.Parent = pill
	local pad = Instance.new("UIPadding")
	pad.PaddingLeft, pad.PaddingRight = UDim.new(0, 18), UDim.new(0, 18)
	pad.Parent = pill
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.AutomaticSize = Enum.AutomaticSize.X
	l.Size = UDim2.fromScale(0, 1)
	l.Font = Enum.Font.BuilderSansExtraBold
	l.TextSize = 24
	l.TextColor3 = C.white
	l.Text = emoji .. "  " .. text
	l.Parent = pill
	return anchor
end

local function prompt(parent: BasePart, name: string, action: string, object: string)
	local att = Instance.new("Attachment")
	att.Parent = parent
	local pp = Instance.new("ProximityPrompt")
	pp.Name = name
	pp.ActionText = action
	pp.ObjectText = object
	pp.HoldDuration = 0
	pp.MaxActivationDistance = 14
	pp.RequiresLineOfSight = false
	pp.Parent = att
	return pp
end

-- A low-poly cone from two crossed pairs of wedges (pines, mountains, snow caps).
local WEDGE_FLIP = CFrame.Angles(0, math.pi, 0)
local function cone(base: CFrame, r: number, h: number, color: Color3)
	for k = 0, 1 do
		local cross = base * CFrame.new(0, h / 2, 0) * CFrame.Angles(0, k * math.pi / 2, 0)
		part({ class = "WedgePart", Size = Vector3.new(r * 1.6, h, r), CFrame = cross * CFrame.new(0, 0, -r / 2), Color = color })
		part({ class = "WedgePart", Size = Vector3.new(r * 1.6, h, r), CFrame = cross * CFrame.new(0, 0, r / 2) * WEDGE_FLIP, Color = color })
	end
end

local function tree(x: number, z: number, s: number, ornaments: boolean?)
	local base = at(x, 0, z) * CFrame.Angles(0, math.random() * 6, 0)
	part({ Size = Vector3.new(1.2, 4, 1.2) * s, CFrame = base * CFrame.new(0, 2 * s, 0), Color = C.woodDark })
	for i, tier in { { 5, 6, 2.5 }, { 3.8, 5, 6.5 }, { 2.4, 4, 9.8 } } do
		local r, h, y = tier[1] * s, tier[2] * s, tier[3] * s
		cone(base * CFrame.new(0, y, 0), r, h, if i % 2 == 0 then C.pineDark else C.pine)
		if not ornaments then
			-- a dusting of snow on each tier
			cone(base * CFrame.new(0, y + h * 0.55, 0), r * 0.45, h * 0.45, C.snow)
		end
		if ornaments then
			for n = 1, 6 do
				local a = n / 6 * math.pi * 2 + i
				local colors = { "ffc83d", "2f8cff", "ffffff", "ff453a" }
				local b = part({ Shape = Enum.PartType.Ball, Size = Vector3.one * 0.8 * s, CFrame = base * CFrame.new(math.cos(a) * r * 0.62, y + h * 0.3, math.sin(a) * r * 0.62), Color = hex(colors[(n + i) % #colors + 1]), Material = Enum.Material.Neon })
				b.CastShadow = false
			end
		end
	end
	if ornaments then
		local star = part({ Size = Vector3.new(1.6, 1.6, 0.4) * s, CFrame = base * CFrame.new(0, 14.3 * s, 0) * CFrame.Angles(0, 0, math.rad(45)), Color = C.gold, Material = Enum.Material.Neon })
		light(star, C.gold, 16, 1.5, true)
	end
end

local function rock(x: number, z: number, s: number)
	local cf = at(x, s * 0.4, z) * CFrame.Angles(0, math.random() * 6, 0)
	part({ Size = Vector3.new(3, 2, 2.4) * s, CFrame = cf * CFrame.Angles(0.2, 0, 0.15), Color = C.rock })
	part({ Size = Vector3.new(2, 1.6, 2) * s, CFrame = cf * CFrame.new(1.2 * s, 0.4 * s, 0.4 * s) * CFrame.Angles(-0.3, 0.6, 0.2), Color = C.rockDark })
	part({ Size = Vector3.new(2.4, 0.4, 2) * s, CFrame = cf * CFrame.new(-0.2 * s, 1.05 * s, 0) * CFrame.Angles(0.2, 0, 0.15), Color = C.snow })
end

-- big low-poly mountains on the horizon: rock body, snow cap
local function mountain(x: number, z: number, r: number, h: number)
	local base = at(x, -1, z) * CFrame.Angles(0, math.random() * 6, 0)
	cone(base, r, h, C.rock)
	cone(base * CFrame.new(0, h * 0.56, 0), r * 0.46, h * 0.46, C.snow)
end

local function snowman(cf: CFrame)
	part({ Shape = Enum.PartType.Ball, Size = Vector3.one * 4, CFrame = cf * CFrame.new(0, 1.8, 0), Color = C.white })
	part({ Shape = Enum.PartType.Ball, Size = Vector3.one * 3, CFrame = cf * CFrame.new(0, 4.6, 0), Color = C.white })
	part({ Shape = Enum.PartType.Ball, Size = Vector3.one * 2.2, CFrame = cf * CFrame.new(0, 6.7, 0), Color = C.white })
	part({ Size = Vector3.new(0.3, 0.3, 1.2), CFrame = cf * CFrame.new(0, 6.7, -1.4), Color = hex("ff8a1f") })
	for _, sx in { -0.4, 0.4 } do
		part({ Size = Vector3.new(0.25, 0.25, 0.1), CFrame = cf * CFrame.new(sx, 7.1, -1.05), Color = C.ink })
	end
	part({ Size = Vector3.new(2.6, 0.5, 2.6), CFrame = cf * CFrame.new(0, 5.8, 0), Color = C.roof })
	part({ Size = Vector3.new(1.6, 1.2, 1.6), CFrame = cf * CFrame.new(0, 8.2, 0), Color = C.ink })
	part({ Size = Vector3.new(2.4, 0.2, 2.4), CFrame = cf * CFrame.new(0, 7.65, 0), Color = C.ink })
end

local function lampPost(cf: CFrame)
	part({ Size = Vector3.new(0.6, 9, 0.6), CFrame = cf * CFrame.new(0, 4.5, 0), Color = C.woodDark })
	part({ Size = Vector3.new(1.6, 0.4, 1.6), CFrame = cf * CFrame.new(0, 9.2, 0), Color = C.woodDark })
	local bulb = part({ Size = Vector3.new(1.1, 1.3, 1.1), CFrame = cf * CFrame.new(0, 8.4, 0), Color = C.warm, Material = Enum.Material.Neon, CastShadow = false })
	light(bulb, C.warm, 18, 0.9)
end

local function log(cf: CFrame, len: number)
	part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(len, 1.6, 1.6), CFrame = cf * CFrame.new(0, 0.8, 0), Color = C.wood })
end

local function board(key: string, title: string, cf: CFrame)
	-- two posts and a flat panel, standing in the snow
	for _, sx in { -1, 1 } do
		part({ Size = Vector3.new(1, 22, 1), CFrame = cf * CFrame.new(sx * 10.5, -2, 0.4), Color = C.woodDark })
	end
	local b = part({ Size = Vector3.new(20, 16, 0.6), CFrame = cf, Color = C.panel })
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 28
	gui.LightInfluence = 0
	gui.Parent = b
	local list = Instance.new("UIListLayout")
	list.Padding = UDim.new(0, 4)
	list.HorizontalAlignment = Enum.HorizontalAlignment.Center
	list.Parent = gui
	local pad = Instance.new("UIPadding")
	pad.PaddingTop = UDim.new(0, 14)
	pad.Parent = gui
	local function row(text: string, h: number, color: Color3, font: Enum.Font)
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.Size = UDim2.new(0.9, 0, 0, h)
		l.Font = font
		l.TextScaled = true
		l.TextColor3 = color
		l.Text = text
		l.TextXAlignment = Enum.TextXAlignment.Left
		l.Parent = gui
		return l
	end
	local t = row(title, 54, C.gold, Enum.Font.BuilderSansExtraBold)
	t.TextXAlignment = Enum.TextXAlignment.Center
	local rows = {}
	for i = 1, 10 do
		local color = if i == 1 then C.gold elseif i == 2 then hex("d9e2ec") elseif i == 3 then hex("e0a96d") else C.white
		table.insert(rows, row(i .. ".  ---", 34, color, Enum.Font.BuilderSansBold))
	end
	boardLabels[key] = rows
end

-- an outfit on a slowly turning pedestal
local function mannequin(equipped, title: string, cf: CFrame)
	disc(cf * CFrame.new(0, 0.6, 0), 2.8, 1.2, C.panel)
	disc(cf * CFrame.new(0, 1.25, 0), 2.6, 0.12, C.blue)
	local m = Outfit.mannequin()
	m:PivotTo(cf * CFrame.new(0, 1.3 + 0.45 + 3.2, 0)) -- the feet on the pedestal
	local o = Outfit.resolve(equipped)
	Outfit.paint(m, o)
	Outfit.attach(m, o, { static = true })
	m.Parent = folder
	CollectionService:AddTag(m, "Turntable")
	local tag = part({ Size = Vector3.new(5, 1.2, 0.3), CFrame = cf * CFrame.new(0, 0.6, -2.95), Color = C.panel })
	sign(tag, Enum.NormalId.Front, title, C.white)
end

-- the ski shop: a little A-frame cabin with an open counter facing the plaza (the cf's -Z)
local function shop(cf: CFrame)
	local W, D, H = 18, 12, 7
	part({ Size = Vector3.new(W, H, D), CFrame = cf * CFrame.new(0, H / 2, 2), Color = C.wood })
	-- the open front: a dark inside and a counter
	part({ Size = Vector3.new(W - 4, H - 2.4, 0.4), CFrame = cf * CFrame.new(0, H / 2 + 0.6, -3.85), Color = hex("4a3220") })
	local counter = part({ Size = Vector3.new(W - 2, 3.4, 2.4), CFrame = cf * CFrame.new(0, 1.7, -5.2), Color = C.woodDark })
	part({ Size = Vector3.new(W - 1.4, 0.4, 3), CFrame = cf * CFrame.new(0, 3.6, -5.2), Color = C.wood })
	-- the roof: two wedges and a snowy ridge
	for _, sx in { -1, 1 } do
		part({ class = "WedgePart", Size = Vector3.new(D + 3, 7, W / 2 + 1.5), CFrame = cf * CFrame.new(sx * (W / 4 + 0.75), H + 3.5, 2) * CFrame.Angles(0, -sx * math.pi / 2, 0), Color = C.roof })
		part({ class = "WedgePart", Size = Vector3.new(D + 3.2, 1.2, W / 2 + 1.7), CFrame = cf * CFrame.new(sx * (W / 4 + 0.75), H + 7.2, 2) * CFrame.Angles(0, -sx * math.pi / 2, 0), Color = C.snow })
	end
	local plate = part({ Size = Vector3.new(11, 2.6, 0.5), CFrame = cf * CFrame.new(0, H + 2.4, -4.6), Color = C.blue })
	sign(plate, Enum.NormalId.Front, "SKI SHOP", C.white)
	-- skis and boards leaning on the cabin
	for i, item in Catalog.skis do
		if i > 5 then
			break
		end
		part({ Size = Vector3.new(0.5, 7, 0.25), CFrame = cf * CFrame.new(-W / 2 - 1.2 - (i - 1) * 0.9, 3.4, -2 + (i - 1) * 1.2) * CFrame.Angles(0.15, 0, 0.12), Color = hex(item.color) })
	end
	for i, item in Catalog.boards do
		if i > 4 then
			break
		end
		part({ Size = Vector3.new(2, 6.4, 0.35), CFrame = cf * CFrame.new(W / 2 + 1.2, 3.1, -2 + (i - 1) * 1.6) * CFrame.Angles(0, math.pi / 2, -0.12), Color = hex(item.color) })
	end
	prompt(counter, "ShopPrompt", "Open shop", "Ski Shop")
	label(cf * CFrame.new(0, H + 11.5, 0), "🛒", "Shop", C.blue)
end

-- the start gate on a raised deck, reached by a ramp from the plaza; the gate's front faces +Z
local function startGate(cf: CFrame)
	local deckY, deckL, width = 5, 18, 26
	-- ramp up from the plaza edge, then the deck
	part({ class = "WedgePart", Size = Vector3.new(width, deckY, 14), CFrame = cf * CFrame.new(0, deckY / 2, 7) * WEDGE_FLIP, Color = C.snowShade })
	part({ Size = Vector3.new(width, deckY, deckL), CFrame = cf * CFrame.new(0, deckY / 2, -deckL / 2), Color = C.snowShade })
	part({ Size = Vector3.new(width - 4, 0.3, deckL - 2), CFrame = cf * CFrame.new(0, deckY + 0.15, -deckL / 2), Color = C.wood })
	-- the gate: two posts and a banner
	local gz = -deckL / 2 - 2
	for _, sx in { -1, 1 } do
		part({ Size = Vector3.new(1.6, 16, 1.6), CFrame = cf * CFrame.new(sx * 9, deckY + 8, gz), Color = C.blue })
		part({ Size = Vector3.new(2.4, 0.6, 2.4), CFrame = cf * CFrame.new(sx * 9, deckY + 0.3, gz), Color = hex("1c5fc0") })
	end
	local banner = part({ Size = Vector3.new(20, 4, 1), CFrame = cf * CFrame.new(0, deckY + 15, gz), Color = C.blue })
	sign(banner, Enum.NormalId.Back, "START", C.white)
	sign(banner, Enum.NormalId.Front, "START", C.white)
	-- step on the glowing strip to ride
	local mat = part({ Size = Vector3.new(16, 0.3, 4), CFrame = cf * CFrame.new(0, deckY + 0.4, gz), Color = hex("7fe0ff"), Material = Enum.Material.Neon, Transparency = 0.2, CastShadow = false })
	prompt(mat, "RidePrompt", "Ride", "Peak Flip").KeyboardKeyCode = Enum.KeyCode.E
	-- railings along the deck, and a fence behind the gate
	for _, sx in { -1, 1 } do
		part({ Size = Vector3.new(0.5, 3, deckL + 14), CFrame = cf * CFrame.new(sx * (width / 2 - 0.25), deckY + 1.5, -deckL / 2 + 7), Color = C.woodDark })
	end
	part({ Size = Vector3.new(width, 12, 1), CFrame = cf * CFrame.new(0, deckY + 6, -deckL + 0.5), Transparency = 1 })
	-- flags flying down the hill beyond the gate
	for i = 1, 6 do
		local side = if i % 2 == 0 then 1 else -1
		local fz = -deckL - 6 - i * 9
		part({ Size = Vector3.new(0.3, 5, 0.3), CFrame = cf * CFrame.new(side * 6, 2.5, fz), Color = C.white })
		part({ Size = Vector3.new(0.1, 1.8, 2.4), CFrame = cf * CFrame.new(side * 6, 4.1, fz + 1.2), Color = if side > 0 then C.blue else C.roof })
	end
	label(cf * CFrame.new(0, deckY + 21, gz), "⛷️", "Ride!", hex("34c759"))
end

local function giftSpot(cf: CFrame)
	disc(cf * CFrame.new(0, 0.5, 0), 5.5, 1, C.panel)
	local chest = part({ Size = Vector3.new(6, 4, 4.4), CFrame = cf * CFrame.new(0, 3, 0), Color = C.wood })
	part({ Size = Vector3.new(6.4, 1.6, 4.8), CFrame = chest.CFrame * CFrame.new(0, 2.7, 0), Color = C.woodDark })
	part({ Size = Vector3.new(1.1, 5.8, 5), CFrame = chest.CFrame * CFrame.new(0, 0.8, 0), Color = C.gold })
	part({ Size = Vector3.new(6.6, 1.1, 1.1), CFrame = chest.CFrame * CFrame.new(0, 0.8, 0), Color = C.gold })
	light(chest, C.gold, 14, 1)
	prompt(chest, "DailyPrompt", "Claim", "Daily Gift")
	label(cf * CFrame.new(0, 10, 0), "🎁", "Daily gift", hex("f59e0b"))
end

local function campfire(cf: CFrame)
	disc(cf * CFrame.new(0, 0.2, 0), 3, 0.4, C.rockDark)
	for i = 0, 7 do
		local a = i / 8 * math.pi * 2
		part({ Size = Vector3.new(1.2, 0.9, 1.2), CFrame = cf * CFrame.new(math.cos(a) * 3, 0.45, math.sin(a) * 3) * CFrame.Angles(0, a, 0), Color = C.rock })
	end
	for _, r in { 0.4, -0.5, 1.6 } do
		part({ Size = Vector3.new(0.7, 0.7, 3.4), CFrame = cf * CFrame.new(0, 0.7, 0) * CFrame.Angles(0, r, 0.3), Color = C.woodDark })
	end
	local core = part({ Size = Vector3.new(2, 1, 2), CFrame = cf * CFrame.new(0, 1.2, 0), Transparency = 1, CanCollide = false })
	local fire = Instance.new("Fire")
	fire.Size, fire.Heat = 5, 9
	fire.Color, fire.SecondaryColor = hex("ff7a00"), hex("ffd23f")
	fire.Parent = core
	light(core, hex("ffb562"), 26, 2, true)
	local embers = Instance.new("ParticleEmitter")
	embers.Rate = 10
	embers.Lifetime = NumberRange.new(0.8, 1.6)
	embers.Speed = NumberRange.new(2, 5)
	embers.LightEmission = 1
	embers.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.25), NumberSequenceKeypoint.new(1, 0) })
	embers.Color = ColorSequence.new(hex("ffc27a"))
	embers.SpreadAngle = Vector2.new(25, 25)
	embers.Parent = core
	-- log benches around it
	for i = 0, 3 do
		local a = i / 4 * math.pi * 2 + math.pi / 4
		log(cf * CFrame.new(math.cos(a) * 8, 0, math.sin(a) * 8) * CFrame.Angles(0, -a + math.pi / 2, 0), 7)
	end
	label(cf * CFrame.new(0, 9, 0), "🔥", "Campfire", hex("ff8a1f"))
end

function Lobby.build()
	folder = Instance.new("Folder")
	folder.Name = "Lobby"
	folder.Parent = workspace
	local rng = Random.new(4)
	math.randomseed(4)

	-- the snowfield, the plaza and its paths
	part({ Size = Vector3.new(900, 4, 900), CFrame = at(0, -2.2, 0), Color = C.snow })
	disc(at(0, -0.1, 0), PLAZA_R + 2, 0.4, C.plazaRing)
	disc(at(0, 0, 0), PLAZA_R, 0.4, C.plaza)
	disc(at(0, 0.05, 0), 9, 0.4, C.plazaRing)
	disc(at(0, 0.1, 0), 7, 0.4, C.blue)
	for _, path in { { -1, 0 }, { 1, 0 }, { 0.6, 0.8 }, { -0.1, 1 } } do
		local dir = Vector3.new(path[1], 0, path[2]).Unit
		local mid = dir * (PLAZA_R + 9)
		part({ Size = Vector3.new(7, 0.4, 20), CFrame = CFrame.lookAt(O + mid + Vector3.new(0, -0.05, 0), O + mid + dir + Vector3.new(0, -0.05, 0)), Color = C.path })
	end
	for i = 0, 7 do
		local a = i / 8 * math.pi * 2 + math.pi / 8
		local x, z = math.cos(a) * (PLAZA_R + 1), math.sin(a) * (PLAZA_R + 1)
		if math.abs(x) > 15 or z > 0 then -- not on the ramp up to the start gate
			lampPost(at(x, 0, z))
		end
	end

	-- the camp's spots
	startGate(at(0, 0, -PLAZA_R - 6))
	shop(at(-(PLAZA_R + 22), 0, 0) * CFrame.Angles(0, -math.pi / 2, 0))
	local looks = {
		{ { jackets = "red", pants = "navy", hats = "helmet", goggles = "orange" }, "Classic" },
		{ { jackets = "blue", pants = "white", hats = "beanieBlue", goggles = "blue", extras = "scarf" }, "Cozy" },
		{ { jackets = "black", pants = "black", hats = "cap", goggles = "glow", extras = "backpack" }, "Night Rider" },
		{ { jackets = "white", pants = "grey", hats = "headphones", goggles = "purple", extras = "jetpack" }, "Jet Set" },
	}
	for i, look in looks do
		local z = -15 + (i - 1) * 10
		mannequin(look[1], look[2], at(-(PLAZA_R + 6), 0, z) * CFrame.Angles(0, -math.pi / 2, 0))
	end
	-- leaderboards facing the plaza from the east
	board("allTime", "TOP RIDERS", at(PLAZA_R + 14, 12, -12) * CFrame.Angles(0, math.pi / 2 - 0.25, 0))
	board("daily", "TODAY'S BEST", at(PLAZA_R + 14, 12, 12) * CFrame.Angles(0, math.pi / 2 + 0.25, 0))
	label(at(PLAZA_R + 15, 23, 0), "🏆", "Leaderboards", hex("a855f7"))
	giftSpot(at((PLAZA_R + 12) * 0.6, 0, (PLAZA_R + 12) * 0.8))
	campfire(at(-3, 0, PLAZA_R + 16))
	tree(-24, PLAZA_R + 14, 1.3, true)
	snowman(at(16, 0, PLAZA_R + 22) * CFrame.Angles(0, math.pi + 0.5, 0))

	-- pines, rocks and snowmen around the camp, mountains on the horizon
	for i = 1, 70 do
		local a = rng:NextNumber(0, math.pi * 2)
		local r = rng:NextNumber(BOUND_R - 6, BOUND_R + 70)
		local x, z = math.cos(a) * r, math.sin(a) * r
		local s = rng:NextNumber(1, 1.9)
		if math.abs(x) > 22 or z > 0 then -- a clear view down the hill past the start gate
			tree(x, z, s)
		end
	end
	for i = 1, 14 do
		local a = rng:NextNumber(0, math.pi * 2)
		local r = rng:NextNumber(PLAZA_R + 20, BOUND_R - 4)
		local x, z = math.cos(a) * r, math.sin(a) * r
		-- keep the start gate's run-out and the spots clear
		if math.abs(x) > 18 or z > 0 then
			rock(x, z, rng:NextNumber(0.8, 1.6))
		end
	end
	for i = 1, 12 do
		local a = (i / 12) * math.pi * 2 + rng:NextNumber(-0.15, 0.15)
		local r = rng:NextNumber(300, 380)
		mountain(math.cos(a) * r, math.sin(a) * r, rng:NextNumber(70, 110), rng:NextNumber(110, 190))
	end
	mountain(0, -330, 140, 260) -- the big one, right behind the start gate

	-- an invisible fence so nobody wanders off into the trees
	for i = 0, 23 do
		local a = i / 24 * math.pi * 2
		part({ Size = Vector3.new(BOUND_R * 0.28, 40, 2), CFrame = at(math.cos(a) * BOUND_R, 20, math.sin(a) * BOUND_R) * CFrame.Angles(0, -a + math.pi / 2, 0), Transparency = 1 })
	end

	-- falling snow over the camp
	local sky = part({ Size = Vector3.new(260, 1, 260), CFrame = at(0, 70, 0), Transparency = 1, CanCollide = false, CanQuery = false, CanTouch = false })
	local snow = Instance.new("ParticleEmitter")
	snow.Shape = Enum.ParticleEmitterShape.Box
	snow.EmissionDirection = Enum.NormalId.Bottom
	snow.Rate = 160
	snow.Lifetime = NumberRange.new(12, 16)
	snow.Speed = NumberRange.new(4, 7)
	snow.Size = NumberSequence.new(0.3)
	snow.SpreadAngle = Vector2.new(20, 20)
	snow.LightEmission = 0.3
	snow.Parent = sky

	-- spawn in the middle of the plaza, facing the start gate
	local spawn = Instance.new("SpawnLocation")
	spawn.Anchored = true
	spawn.Size = Vector3.new(10, 0.4, 10)
	spawn.CFrame = at(0, 0.3, 8)
	spawn.Transparency = 1
	spawn.CanCollide = false
	spawn.Duration = 0
	spawn.Neutral = true
	spawn.Parent = folder
	local decal = spawn:FindFirstChildOfClass("Decal")
	if decal then
		decal:Destroy()
	end
end

function Lobby.spawnCFrame(): CFrame
	return at(math.random(-6, 6), 4, 8 + math.random(-4, 4))
end

local function commas(n: number): string
	local s = tostring(math.floor(n))
	local out = string.gsub(string.reverse((string.gsub(string.reverse(s), "(%d%d%d)", "%1,"))), "^,", "")
	return out
end

function Lobby.setBoards(data)
	for key, rows in boardLabels do
		local list = data[key] or {}
		for i, l in rows do
			local r = list[i]
			l.Text = if r then string.format("%d.  %s   %s", i, r.name, commas(r.score)) else i .. ".  ---"
		end
	end
end

-- name + level above each rider: a small flat pill
function Lobby.setTag(char: Model, name: string, level: number, vip: boolean)
	local head = char:FindFirstChild("Head") :: BasePart?
	if not head then
		return
	end
	local gui = head:FindFirstChild("PeakFlipTag") :: BillboardGui?
	if not gui then
		local g = Instance.new("BillboardGui")
		g.Name = "PeakFlipTag"
		g.Size = UDim2.fromOffset(200, 30)
		g.StudsOffset = Vector3.new(0, 2.4, 0)
		g.MaxDistance = 120
		g.LightInfluence = 0
		local pill = Instance.new("Frame")
		pill.Name = "Pill"
		pill.AnchorPoint = Vector2.new(0.5, 0.5)
		pill.Position = UDim2.fromScale(0.5, 0.5)
		pill.Size = UDim2.fromScale(0, 1)
		pill.AutomaticSize = Enum.AutomaticSize.X
		pill.BackgroundColor3 = C.panel
		pill.BackgroundTransparency = 0.25
		pill.Parent = g
		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(1, 0)
		corner.Parent = pill
		local pad = Instance.new("UIPadding")
		pad.PaddingLeft, pad.PaddingRight = UDim.new(0, 4), UDim.new(0, 12)
		pad.Parent = pill
		local list = Instance.new("UIListLayout")
		list.FillDirection = Enum.FillDirection.Horizontal
		list.VerticalAlignment = Enum.VerticalAlignment.Center
		list.Padding = UDim.new(0, 6)
		list.SortOrder = Enum.SortOrder.LayoutOrder
		list.Parent = pill
		local lv = Instance.new("TextLabel")
		lv.Name = "Level"
		lv.LayoutOrder = 1
		lv.Size = UDim2.fromOffset(0, 22)
		lv.AutomaticSize = Enum.AutomaticSize.X
		lv.BackgroundColor3 = C.blue
		lv.Font = Enum.Font.BuilderSansExtraBold
		lv.TextSize = 14
		lv.TextColor3 = C.white
		local lvCorner = Instance.new("UICorner")
		lvCorner.CornerRadius = UDim.new(1, 0)
		lvCorner.Parent = lv
		local lvPad = Instance.new("UIPadding")
		lvPad.PaddingLeft, lvPad.PaddingRight = UDim.new(0, 8), UDim.new(0, 8)
		lvPad.Parent = lv
		lv.Parent = pill
		local nm = Instance.new("TextLabel")
		nm.Name = "Name"
		nm.LayoutOrder = 2
		nm.BackgroundTransparency = 1
		nm.Size = UDim2.fromOffset(0, 26)
		nm.AutomaticSize = Enum.AutomaticSize.X
		nm.Font = Enum.Font.BuilderSansExtraBold
		nm.TextSize = 18
		nm.Parent = pill
		g.Parent = head
		gui = g
	end
	local pill = (gui :: BillboardGui):FindFirstChild("Pill") :: Frame
	if not pill then
		return
	end
	local nameLabel = pill:FindFirstChild("Name") :: TextLabel
	local levelLabel = pill:FindFirstChild("Level") :: TextLabel
	nameLabel.Text = (if vip then "👑 " else "") .. name
	nameLabel.TextColor3 = if vip then C.gold else C.white
	levelLabel.Text = tostring(level)
end

return Lobby
