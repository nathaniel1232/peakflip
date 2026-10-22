-- The shared lobby: a warm, bright ski lodge where everyone hangs out between runs. Cream walls with
-- wood trim, soft ceiling lights, fireplaces, sofas, a Christmas tree, a ski shop with outfits on
-- rotating mannequins, leaderboards, and big doors out to the slopes. Everything is smooth plastic. Built by the server so all players see the same thing; clients
-- react to the prompts by name and animate anything tagged "Flicker" or "Turntable".
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

-- room size
local HX, HZ, H = 70, 55, 32

-- a handful of colours for the whole lodge
local C = {
	wall = Theme.cream,
	wood = Theme.wood,
	woodDark = Theme.woodDark,
	floor = hex("c99a6a"),
	stone = Theme.stone,
	stoneDark = hex("7f8893"),
	fabric = Theme.fabric,
	gold = Theme.gold,
	snow = Theme.snow,
	warm = Theme.warmLight,
	pine = hex("2f6b4f"),
}

local function part(props): BasePart
	local p = Instance.new(props.class or "Part") :: BasePart
	props.class = nil
	p.Anchored = true
	p.TopSurface, p.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in props do
		if k ~= "Parent" then
			(p :: any)[k] = v
		end
	end
	if p.Material ~= Enum.Material.Neon and p.Material ~= Enum.Material.Glass then
		p.Material = Enum.Material.SmoothPlastic
	end
	p.Parent = props.Parent or folder
	return p
end

local function at(x: number, y: number, z: number): CFrame
	return CFrame.new(O + Vector3.new(x, y, z))
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
	l.Font = Enum.Font.FredokaOne
	l.Text = text
	l.TextColor3 = color
	l.TextScaled = true
	local st = Instance.new("UIStroke")
	st.Thickness = 3
	st.Color = Theme.ink
	st.Parent = l
	l.Parent = gui
	gui.Parent = parent
	return l
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

local WEDGE_FLIP = CFrame.Angles(0, math.pi, 0)
local function tree(x: number, z: number, s: number, ornaments: boolean?)
	local base = at(x, 0, z) * CFrame.Angles(0, math.random() * 6, 0)
	part({ Size = Vector3.new(1.2, 4, 1.2) * s, CFrame = base * CFrame.new(0, 2 * s, 0), Color = C.woodDark })
	for i, tier in { { 5, 6, 5.5 }, { 3.8, 5, 9 }, { 2.4, 4, 12 }, { 1.1, 2, 14.5 } } do
		local r, h, y = tier[1] * s, tier[2] * s, tier[3] * s
		local color = if ornaments then C.pine elseif i % 2 == 0 then C.snow else C.pine
		for k = 0, 1 do
			local cross = base * CFrame.new(0, y, 0) * CFrame.Angles(0, k * math.pi / 2, 0)
			part({ class = "WedgePart", Size = Vector3.new(r * 1.6, h, r), CFrame = cross * CFrame.new(0, 0, -r / 2), Color = color })
			part({ class = "WedgePart", Size = Vector3.new(r * 1.6, h, r), CFrame = cross * CFrame.new(0, 0, r / 2) * WEDGE_FLIP, Color = color })
		end
		if ornaments then
			for n = 1, 6 do
				local a = n / 6 * math.pi * 2 + i
				local colors = { "ffc83d", "2f8cff", "ffffff" }
				local b = part({ Shape = Enum.PartType.Ball, Size = Vector3.one * 0.7 * s, CFrame = base * CFrame.new(math.cos(a) * r * 0.75, y - h * 0.25, math.sin(a) * r * 0.75), Color = hex(colors[(n + i) % #colors + 1]), Material = Enum.Material.Neon })
				b.CastShadow = false
			end
		end
	end
	if ornaments then
		local star = part({ Size = Vector3.new(1.6, 1.6, 0.4) * s, CFrame = base * CFrame.new(0, 16.3 * s, 0) * CFrame.Angles(0, 0, math.rad(45)), Color = C.gold, Material = Enum.Material.Neon })
		light(star, C.gold, 16, 1.5, true)
	end
end

-- A smooth cream wall along x (or z) with wood trim, leaving holes: { {from, to, bottom, top} }
local function wall(alongX: boolean, fixed: number, from: number, to: number, holes)
	local function block(a: number, b: number, y0: number, y1: number, color: Color3, depth: number)
		local len, mid, h = b - a, (a + b) / 2, y1 - y0
		if len <= 0.01 or h <= 0.01 then
			return
		end
		local size = if alongX then Vector3.new(len, h, depth) else Vector3.new(depth, h, len)
		local cf = if alongX then at(mid, (y0 + y1) / 2, fixed) else at(fixed, (y0 + y1) / 2, mid)
		part({ Size = size, CFrame = cf, Color = color })
	end
	table.sort(holes, function(x, y)
		return x[1] < y[1]
	end)
	local cursor = from
	for _, hole in holes do
		block(cursor, hole[1], 0, H, C.wall, 2)
		block(hole[1], hole[2], 0, hole[3], C.wall, 2)
		block(hole[1], hole[2], hole[4], H, C.wall, 2)
		cursor = hole[2]
	end
	block(cursor, to, 0, H, C.wall, 2)
	-- wood trim: a skirting board, a picture rail and posts every 20 studs
	for _, band in { { 0, 1.4 }, { H - 1.2, H } } do
		local cut = cursor
		cursor = from
		for _, hole in holes do
			if band[2] <= hole[3] or band[1] >= hole[4] then
				continue
			end
			block(cursor, hole[1], band[1], band[2], C.wood, 2.4)
			cursor = hole[2]
		end
		block(cursor, to, band[1], band[2], C.wood, 2.4)
		cursor = cut
	end
	for x = from, to, 20 do
		local inHole = false
		for _, hole in holes do
			if x > hole[1] - 1 and x < hole[2] + 1 then
				inHole = true
			end
		end
		if not inHole then
			block(x - 0.7, x + 0.7, 0, H, C.wood, 2.6)
		end
	end
end

local function window(cf: CFrame, w: number, h: number)
	part({ Size = Vector3.new(w, h, 0.3), CFrame = cf, Color = hex("dff1ff"), Material = Enum.Material.Glass, Transparency = 0.7, CastShadow = false })
	for _, sx in { -1, 1 } do
		part({ Size = Vector3.new(0.8, h + 0.8, 2.4), CFrame = cf * CFrame.new(sx * w / 2, 0, 0), Color = C.wood })
	end
	for _, sy in { -1, 1 } do
		part({ Size = Vector3.new(w + 0.8, 0.8, 2.4), CFrame = cf * CFrame.new(0, sy * h / 2, 0), Color = C.wood })
	end
	part({ Size = Vector3.new(0.4, h, 0.6), CFrame = cf, Color = C.wood })
end

-- a stone fireplace against a wall; the cf's -Z points into the room
local function fireplace(cf: CFrame)
	part({ Size = Vector3.new(16, H, 4), CFrame = cf * CFrame.new(0, H / 2, 0), Color = C.stone })
	part({ Size = Vector3.new(9, 7, 2.2), CFrame = cf * CFrame.new(0, 3.5, -1.0), Color = hex("2a2f36") })
	part({ Size = Vector3.new(19, 1, 6), CFrame = cf * CFrame.new(0, 0.5, -3), Color = C.stoneDark })
	part({ Size = Vector3.new(18, 1, 2.6), CFrame = cf * CFrame.new(0, 9.5, -2.4), Color = C.wood })
	for _, sx in { -1, 1 } do
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(5, 0.9, 0.9), CFrame = cf * CFrame.new(sx * 0.6, 1.5, -1.6) * CFrame.Angles(0, sx * 0.3, 0), Color = C.woodDark })
	end
	local core = part({ Size = Vector3.new(4, 1, 1), CFrame = cf * CFrame.new(0, 2.2, -1.6), Transparency = 1, CanCollide = false })
	local fire = Instance.new("Fire")
	fire.Size, fire.Heat = 7, 9
	fire.Color, fire.SecondaryColor = hex("ff7a00"), hex("ffd23f")
	fire.Parent = core
	light(core, hex("ffb562"), 36, 2.4, true)
	local embers = Instance.new("ParticleEmitter")
	embers.Rate = 12
	embers.Lifetime = NumberRange.new(0.8, 1.6)
	embers.Speed = NumberRange.new(2, 5)
	embers.LightEmission = 1
	embers.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.25), NumberSequenceKeypoint.new(1, 0) })
	embers.Color = ColorSequence.new(hex("ffc27a"))
	embers.SpreadAngle = Vector2.new(25, 25)
	embers.Parent = core
	-- candles on the mantel
	for _, sx in { -6, -3, 3, 6 } do
		part({ Size = Vector3.new(0.5, 1.2, 0.5), CFrame = cf * CFrame.new(sx, 10.6, -2.4), Color = hex("f7f1e1") })
		local flame = part({ Shape = Enum.PartType.Ball, Size = Vector3.one * 0.35, CFrame = cf * CFrame.new(sx, 11.35, -2.4), Color = C.warm, Material = Enum.Material.Neon, CastShadow = false })
		light(flame, C.warm, 8, 0.8, true)
	end
end

local function sofa(cf: CFrame, w: number, color: Color3)
	part({ Size = Vector3.new(w, 1.6, 4), CFrame = cf * CFrame.new(0, 1.3, 0), Color = color })
	part({ Size = Vector3.new(w, 3.2, 1.2), CFrame = cf * CFrame.new(0, 2.6, 1.6), Color = color })
	for _, sx in { -1, 1 } do
		part({ Size = Vector3.new(1.2, 2.6, 4), CFrame = cf * CFrame.new(sx * (w / 2 - 0.6), 2, 0), Color = color })
	end
	part({ Size = Vector3.new(w, 0.5, 4), CFrame = cf * CFrame.new(0, 0.25, 0), Color = C.woodDark })
	local n = math.floor(w / 3.2)
	for i = 1, n do
		local x = -w / 2 + 1.2 + (i - 0.5) * ((w - 2.4) / n)
		part({ Size = Vector3.new(2.4, 1.6, 0.6), CFrame = cf * CFrame.new(x, 3.1, 0.9) * CFrame.Angles(-0.2, 0, 0), Color = Color3.new(1, 1, 1):Lerp(color, 0.5) })
	end
end

local function coffeeTable(cf: CFrame)
	part({ Size = Vector3.new(8, 0.5, 4), CFrame = cf * CFrame.new(0, 2, 0), Color = C.wood })
	for _, sx in { -1, 1 } do
		for _, sz in { -1, 1 } do
			part({ Size = Vector3.new(0.5, 1.8, 0.5), CFrame = cf * CFrame.new(sx * 3.5, 0.9, sz * 1.6), Color = C.woodDark })
		end
	end
	-- hot chocolate
	for _, sx in { -1.5, 1.2 } do
		part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.9, 0.7, 0.7), CFrame = cf * CFrame.new(sx, 2.7, 0.3) * CFrame.Angles(0, 0, math.pi / 2), Color = if sx < 0 then hex("e63946") else hex("f7f1e1") })
	end
end

local function chandelier(x: number, z: number)
	local y = H - 7
	part({ Size = Vector3.new(0.3, 7, 0.3), CFrame = at(x, H - 3.5, z), Color = C.woodDark })
	part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.6, 7, 7), CFrame = at(x, y, z) * CFrame.Angles(0, 0, math.pi / 2), Color = C.wood })
	for i = 0, 7 do
		local a = i / 8 * math.pi * 2
		part({ Size = Vector3.new(0.35, 0.9, 0.35), CFrame = at(x + math.cos(a) * 3, y + 0.75, z + math.sin(a) * 3), Color = hex("f7f1e1") })
		local bulb = part({ Shape = Enum.PartType.Ball, Size = Vector3.one * 0.4, CFrame = at(x + math.cos(a) * 3, y + 1.4, z + math.sin(a) * 3), Color = C.warm, Material = Enum.Material.Neon, CastShadow = false })
		if i % 4 == 0 then
			light(bulb, C.warm, 26, 1.2, true)
		end
	end
end

local function lantern(cf: CFrame)
	part({ Size = Vector3.new(1, 1.6, 1), CFrame = cf, Color = C.woodDark })
	local glass = part({ Size = Vector3.new(0.7, 1.1, 0.7), CFrame = cf, Color = C.warm, Material = Enum.Material.Neon, CastShadow = false })
	light(glass, C.warm, 14, 1, true)
end

local function board(key: string, title: string, cf: CFrame)
	local b = part({ Size = Vector3.new(20, 16, 0.6), CFrame = cf, Color = Theme.panel })
	part({ Size = Vector3.new(21.6, 17.6, 0.5), CFrame = cf * CFrame.new(0, 0, 0.3), Color = C.wood })
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
	pad.PaddingTop = UDim.new(0, 12)
	pad.Parent = gui
	local function row(text: string, h: number, color: Color3, font: Enum.Font)
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.Size = UDim2.new(0.92, 0, 0, h)
		l.Font = font
		l.TextScaled = true
		l.TextColor3 = color
		l.Text = text
		l.TextXAlignment = Enum.TextXAlignment.Left
		l.Parent = gui
		return l
	end
	local t = row(title, 58, C.gold, Enum.Font.FredokaOne)
	t.TextXAlignment = Enum.TextXAlignment.Center
	local rows = {}
	for i = 1, 10 do
		local color = if i == 1 then C.gold elseif i == 2 then hex("d9e2ec") elseif i == 3 then hex("e0a96d") else Color3.new(1, 1, 1)
		table.insert(rows, row(i .. ".  ---", 34, color, Enum.Font.GothamBold))
	end
	boardLabels[key] = rows
end

-- an outfit on a slowly turning pedestal
local function mannequin(equipped, title: string, cf: CFrame)
	part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.4, 6, 6), CFrame = cf * CFrame.new(0, 0.7, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = C.woodDark })
	local ring = part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 6.3, 6.3), CFrame = cf * CFrame.new(0, 1.3, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = Theme.primary, Material = Enum.Material.Neon, CastShadow = false })
	light(ring, Theme.primary, 8, 0.6)
	local m = Outfit.mannequin()
	m:PivotTo(cf * CFrame.new(0, 1.4 + 0.45 + 3.2, 0))
	m.Parent = folder
	local o = Outfit.resolve(equipped)
	Outfit.paint(m, o)
	Outfit.attach(m, o)
	CollectionService:AddTag(m, "Turntable")
	local tag = part({ Size = Vector3.new(5.5, 1.4, 0.3), CFrame = cf * CFrame.new(0, 0.8, -3.3), Color = Theme.panel })
	sign(tag, Enum.NormalId.Front, title, Color3.new(1, 1, 1))
end

-- a soft, even light from a panel in the ceiling (the main light in the lodge)
local function ceilingLight(x: number, z: number)
	local panel = part({ Size = Vector3.new(8, 0.3, 8), CFrame = at(x, H - 0.2, z), Color = hex("fff6e8"), Material = Enum.Material.Neon, CastShadow = false })
	local l = Instance.new("SurfaceLight")
	l.Face = Enum.NormalId.Bottom
	l.Color = hex("fff1dc")
	l.Range = 48
	l.Angle = 120
	l.Brightness = 1.6
	l.Shadows = false
	l.Parent = panel
end

function Lobby.build()
	folder = Instance.new("Folder")
	folder.Name = "Lobby"
	folder.Parent = workspace

	-- outside: snowfield, pines, falling snow (only outside the lodge)
	part({ Size = Vector3.new(700, 4, 700), CFrame = at(0, -2.2, 0), Color = C.snow })
	local rng = Random.new(4)
	for i = 1, 40 do
		local a = i / 40 * math.pi * 2 + rng:NextNumber(-0.06, 0.06)
		local r = rng:NextNumber(95, 150)
		tree(math.cos(a) * r, math.sin(a) * r, rng:NextNumber(1.1, 1.8))
	end
	for _, band in { { 0, -HZ - 40, 400, 70 }, { 0, HZ + 40, 400, 70 }, { -HX - 40, 0, 70, 2 * HZ }, { HX + 40, 0, 70, 2 * HZ } } do
		local sky = part({ Size = Vector3.new(band[3], 1, band[4]), CFrame = at(band[1], 60, band[2]), Transparency = 1, CanCollide = false, CanQuery = false })
		local snow = Instance.new("ParticleEmitter")
		snow.Shape = Enum.ParticleEmitterShape.Box
		snow.EmissionDirection = Enum.NormalId.Bottom
		snow.Rate = 100
		snow.Lifetime = NumberRange.new(12, 16)
		snow.Speed = NumberRange.new(4, 7)
		snow.Size = NumberSequence.new(0.35)
		snow.SpreadAngle = Vector2.new(20, 20)
		snow.LightEmission = 0.3
		snow.Parent = sky
	end

	-- floor, rugs, ceiling with beams and light panels
	part({ Size = Vector3.new(2 * HX, 1, 2 * HZ), CFrame = at(0, -0.5, 0), Color = C.floor })
	part({ Size = Vector3.new(34, 0.25, 24), CFrame = at(0, 0.12, 8), Color = C.fabric })
	part({ Size = Vector3.new(30, 0.27, 20), CFrame = at(0, 0.13, 8), Color = hex("35609e") })
	part({ Size = Vector3.new(10, 0.25, 40), CFrame = at(0, 0.12, -34), Color = C.fabric })
	part({ Size = Vector3.new(2 * HX + 4, 1, 2 * HZ + 4), CFrame = at(0, H + 0.5, 0), Color = C.wall })
	for x = -HX + 10, HX - 10, 20 do
		part({ Size = Vector3.new(1.6, 1.6, 2 * HZ), CFrame = at(x, H - 0.8, 0), Color = C.wood })
	end
	for _, x in { -45, -15, 15, 45 } do
		for _, z in { -32, 0, 32 } do
			ceilingLight(x, z)
		end
	end

	-- walls: big windows on the long sides, the doors out to the slopes at the north end
	local winY0, winY1 = 6, 22
	wall(true, -HZ, -HX, HX, { { -9, 9, 0, 22 } })
	wall(true, HZ, -HX, HX, {})
	wall(false, -HX, -HZ, HZ, { { -46, -24, winY0, winY1 }, { 24, 46, winY0, winY1 } })
	wall(false, HX, -HZ, HZ, { { -46, -24, winY0, winY1 }, { 24, 46, winY0, winY1 } })
	for _, sx in { -1, 1 } do
		for _, z in { -35, 35 } do
			window(at(sx * HX, (winY0 + winY1) / 2, z) * CFrame.Angles(0, sx * math.pi / 2, 0), 22, winY1 - winY0)
		end
	end

	-- the doors out
	local doorZ = -HZ
	part({ Size = Vector3.new(20, 2, 3), CFrame = at(0, 23, doorZ), Color = C.woodDark })
	for _, sx in { -1, 1 } do
		part({ Size = Vector3.new(2, 22, 3), CFrame = at(sx * 10, 11, doorZ), Color = C.woodDark })
		-- the doors stand open, swung outward
		part({ Size = Vector3.new(8.6, 21, 0.8), CFrame = at(sx * 9, 10.5, doorZ - 1) * CFrame.Angles(0, sx * math.rad(70), 0) * CFrame.new(-sx * 4.3, 0, 0), Color = C.wood })
	end
	local doorGlow = part({ Size = Vector3.new(18, 21, 0.4), CFrame = at(0, 10.5, doorZ - 2), Color = hex("e6f4ff"), Material = Enum.Material.Neon, Transparency = 0.5, CastShadow = false, CanCollide = false })
	light(doorGlow, hex("e6f4ff"), 26, 1.2)
	local banner = part({ Size = Vector3.new(26, 5, 1), CFrame = at(0, 27.5, doorZ + 1.2), Color = Theme.primary })
	sign(banner, Enum.NormalId.Back, "TO THE SLOPES", Color3.new(1, 1, 1))
	local mat = part({ Size = Vector3.new(16, 0.4, 8), CFrame = at(0, 0.2, doorZ + 6), Color = Theme.primary, Material = Enum.Material.Neon, Transparency = 0.3, CastShadow = false })
	prompt(mat, "RidePrompt", "Ride", "Peak Flip").KeyboardKeyCode = Enum.KeyCode.E
	-- an invisible wall in the doorway: the glowing mat is the way out
	part({ Size = Vector3.new(18, 21, 1), CFrame = at(0, 10.5, doorZ - 1), Transparency = 1 })

	-- fireplaces with sofas
	for _, sx in { -1, 1 } do
		fireplace(at(sx * (HX - 2), 0, 0) * CFrame.Angles(0, sx * math.pi / 2, 0))
		sofa(at(sx * (HX - 26), 0, 0) * CFrame.Angles(0, sx * -math.pi / 2, 0), 14, C.fabric)
		sofa(at(sx * (HX - 16), 0, -12) * CFrame.Angles(0, math.pi, 0), 10, C.fabric)
		sofa(at(sx * (HX - 16), 0, 12), 10, C.fabric)
		coffeeTable(at(sx * (HX - 16), 0, 0) * CFrame.Angles(0, math.pi / 2, 0))
		part({ Size = Vector3.new(18, 0.2, 26), CFrame = at(sx * (HX - 15), 0.11, 0), Color = hex("e2d6c1") })
	end

	-- a pendant lamp over each sofa corner and lanterns between the windows
	for _, z in { -30, 0, 30 } do
		chandelier(0, z)
	end
	for _, sx in { -1, 1 } do
		lantern(at(sx * (HX - 1.5), 13, 0 + 14))
		lantern(at(sx * (HX - 1.5), 13, 0 - 14))
	end

	-- the shop corner (south-west): counter, gear on the wall, outfits on pedestals
	local counter = part({ Size = Vector3.new(22, 4, 4), CFrame = at(-40, 2, 44), Color = C.wood })
	part({ Size = Vector3.new(23, 0.5, 5), CFrame = at(-40, 4.25, 44), Color = C.woodDark })
	local shopSign = part({ Size = Vector3.new(18, 5, 0.6), CFrame = at(-40, 16, HZ - 1.5), Color = Theme.primary })
	sign(shopSign, Enum.NormalId.Front, "SKI SHOP", Color3.new(1, 1, 1))
	prompt(counter, "ShopPrompt", "Open shop", "Ski Shop")
	for i, item in Catalog.skis do
		if i > 6 then
			break
		end
		part({ Size = Vector3.new(0.5, 9, 0.25), CFrame = at(-55 + (i - 1) * 3, 7, HZ - 1.6) * CFrame.Angles(0, 0, math.rad(8)), Color = hex(item.color) })
	end
	for i, item in Catalog.boards do
		if i > 5 then
			break
		end
		part({ Size = Vector3.new(2.2, 8, 0.35), CFrame = at(-29 + (i - 1) * 3.2, 6.5, HZ - 1.6), Color = hex(item.color) })
	end
	local looks = {
		{ { jackets = "red", pants = "navy", hats = "helmet", goggles = "orange" }, "Classic" },
		{ { jackets = "blue", pants = "white", hats = "beanieBlue", goggles = "blue", extras = "scarf" }, "Cozy" },
		{ { jackets = "black", pants = "black", hats = "cap", goggles = "glow", extras = "backpack" }, "Night Rider" },
		{ { jackets = "white", pants = "grey", hats = "headphones", goggles = "purple", extras = "jetpack" }, "Jet Set" },
	}
	for i, look in looks do
		mannequin(look[1], look[2], at(-56 + (i - 1) * 11, 0, 26))
	end

	-- Christmas tree + the daily gift (south-east)
	tree(48, 40, 1.3, true)
	for i = 1, 7 do
		local a = i / 7 * math.pi * 2
		local colors = { Theme.primary, C.gold, Color3.new(1, 1, 1) }
		local sz = 1.4 + (i % 3) * 0.6
		part({ Size = Vector3.new(sz, sz, sz), CFrame = at(48 + math.cos(a) * 6, sz / 2, 40 + math.sin(a) * 6) * CFrame.Angles(0, a, 0), Color = colors[i % #colors + 1] })
	end
	local chest = part({ Size = Vector3.new(7, 4.5, 5), CFrame = at(36, 2.25, 34) * CFrame.Angles(0, -0.4, 0), Color = C.wood })
	part({ Size = Vector3.new(7.4, 1.8, 5.4), CFrame = chest.CFrame * CFrame.new(0, 2.95, 0), Color = C.woodDark })
	part({ Size = Vector3.new(1.2, 6.6, 5.6), CFrame = chest.CFrame * CFrame.new(0, 0.85, 0), Color = C.gold })
	local giftSign = part({ Size = Vector3.new(10, 3, 0.5), CFrame = chest.CFrame * CFrame.new(0, 7.5, 0), Color = Theme.primary })
	sign(giftSign, Enum.NormalId.Front, "DAILY GIFT", Color3.new(1, 1, 1))
	sign(giftSign, Enum.NormalId.Back, "DAILY GIFT", Color3.new(1, 1, 1))
	light(chest, C.gold, 12, 1)
	prompt(chest, "DailyPrompt", "Claim", "Daily Gift")

	-- leaderboards on the south wall
	board("allTime", "TOP RIDERS", at(4, 13, HZ - 1.4))
	board("daily", "TODAY'S BEST", at(28, 13, HZ - 1.4))

	-- spawn on the big rug
	local spawn = Instance.new("SpawnLocation")
	spawn.Anchored = true
	spawn.Size = Vector3.new(10, 0.4, 10)
	spawn.CFrame = at(0, 0.3, 10)
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
	return at(math.random(-6, 6), 4, 10 + math.random(-6, 6))
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

-- name + level above each avatar
function Lobby.setTag(char: Model, name: string, level: number, vip: boolean)
	local head = char:FindFirstChild("Head") :: BasePart?
	if not head then
		return
	end
	local gui = head:FindFirstChild("PeakFlipTag") :: BillboardGui?
	if not gui then
		local g = Instance.new("BillboardGui")
		g.Name = "PeakFlipTag"
		g.Size = UDim2.fromScale(6, 1.6)
		g.StudsOffset = Vector3.new(0, 2.8, 0)
		g.MaxDistance = 120
		for i, n in { "Name", "Level" } do
			local l = Instance.new("TextLabel")
			l.Name = n
			l.BackgroundTransparency = 1
			l.Size = UDim2.fromScale(1, 0.55)
			l.Position = UDim2.fromScale(0, (i - 1) * 0.55)
			l.Font = Enum.Font.FredokaOne
			l.TextScaled = true
			l.TextColor3 = Color3.new(1, 1, 1)
			local st = Instance.new("UIStroke")
			st.Thickness = 2
			st.Parent = l
			l.Parent = g
		end
		g.Parent = head
		gui = g
	end
	local g = gui :: BillboardGui
	local nameLabel = g:FindFirstChild("Name") :: TextLabel
	local levelLabel = g:FindFirstChild("Level") :: TextLabel
	nameLabel.Text = (if vip then "👑 " else "") .. name
	nameLabel.TextColor3 = if vip then C.gold else Color3.new(1, 1, 1)
	levelLabel.Text = "Lv. " .. level
	levelLabel.TextColor3 = hex("7df9ff")
end

return Lobby
