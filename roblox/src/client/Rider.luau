-- The skier. Normally a local copy of the player's own avatar wearing skis and holding poles,
-- posed every frame from the simulation state; if the avatar can't be copied, the blocky skier
-- from the web game stands in. A crash turns a copy of the rider into a ragdoll.
local Debris = game:GetService("Debris")

local Util = require(script.Parent.Util)
local World = require(script.Parent.World)

local hex = Color3.fromHex
local S = World.S

local Rider = {}

local holder = Instance.new("Model")
holder.Name = "Rider"
holder.Parent = workspace

local gear = {
	ski = hex("1d3557"),
	tip = hex("e63946"),
	material = Enum.Material.SmoothPlastic,
	tipMaterial = Enum.Material.SmoothPlastic,
	deck = hex("2f80ed"),
	accent = hex("ffffff"),
	binding = hex("1b1b1f"),
	deckMaterial = Enum.Material.SmoothPlastic,
	accentMaterial = Enum.Material.SmoothPlastic,
	trail = { hex("c3d4e4") },
	glow = false,
}
local gearType = "skis" -- or "board"
local BOARD_YAW = CFrame.Angles(0, math.pi / 2, 0) -- a snowboarder stands sideways

local function newPart(size: Vector3, color: Color3, material: Enum.Material?): Part
	local p = Instance.new("Part")
	p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
	p.TopSurface, p.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
	p.Material = material or Enum.Material.SmoothPlastic
	p.Color = color
	p.Size = size
	return p
end

-- ---------- trails & particles (shared by both riders) ----------
local trails: { Trail } = {}
local trailGear: { [Trail]: string } = {}
local function addTrail(ski: BasePart, halfWidth: number, tailZ: number, kind: string?)
	local a0, a1 = Instance.new("Attachment"), Instance.new("Attachment")
	a0.Position = Vector3.new(-halfWidth, -ski.Size.Y / 2, tailZ)
	a1.Position = Vector3.new(halfWidth, -ski.Size.Y / 2, tailZ)
	a0.Parent, a1.Parent = ski, ski
	local t = Instance.new("Trail")
	t.Attachment0, t.Attachment1 = a0, a1
	t.Lifetime = 2.2
	t.FaceCamera = false
	t.Transparency = NumberSequence.new(0.3, 1)
	t.LightInfluence = 1
	t.Parent = ski
	table.insert(trails, t)
	trailGear[t] = kind or "skis"
	return t
end

local function trailSequence(colors: { Color3 }): ColorSequence
	if #colors == 1 then
		return ColorSequence.new(colors[1])
	end
	local keys = {}
	for i, c in colors do
		table.insert(keys, ColorSequenceKeypoint.new((i - 1) / (#colors - 1), c))
	end
	return ColorSequence.new(keys)
end

local function styleTrails()
	for _, t in trails do
		t.Color = trailSequence(gear.trail)
		t.LightEmission = if gear.glow then 0.8 else 0
		t.LightInfluence = if gear.glow then 0 else 1
		t.WidthScale = NumberSequence.new(1, if gear.glow then 0.4 else 1)
	end
end

local fx = Instance.new("Part")
fx.Anchored, fx.CanCollide, fx.CanQuery, fx.CanTouch, fx.Transparency = true, false, false, false, 1
fx.Size = Vector3.one * 0.2
fx.Name = "Fx"
fx.Parent = holder

local function emitter(props): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.Rate = 0
	e.LightInfluence = 0.6
	e.Drag = 3
	e.SpreadAngle = Vector2.new(70, 70)
	e.Acceleration = Vector3.new(0, -20, 0)
	for k, v in props do
		(e :: any)[k] = v
	end
	e.Parent = fx
	return e
end
local puff = emitter({
	Lifetime = NumberRange.new(0.4, 0.9),
	Speed = NumberRange.new(5, 15),
	Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.9), NumberSequenceKeypoint.new(1, 0.15) }),
	Transparency = NumberSequence.new(0.1, 1),
})
local spark = emitter({
	Lifetime = NumberRange.new(0.3, 0.6),
	Speed = NumberRange.new(6, 13),
	LightEmission = 1,
	Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.6), NumberSequenceKeypoint.new(1, 0) }),
	Acceleration = Vector3.new(0, -8, 0),
})

-- emit n particles at a simulation-space point
function Rider.emit(x: number, y: number, z: number, n: number, color: Color3, sparkly: boolean?)
	fx.CFrame = CFrame.new(World.point(x, y, z))
	local e = if sparkly then spark else puff
	e.Color = ColorSequence.new(color)
	e:Emit(n)
end

-- blob shadow
local shadow = newPart(Vector3.new(0.02, 1.7, 1.7) * S, hex("1b3550"))
shadow.Shape = Enum.PartType.Cylinder
shadow.CastShadow = false
shadow.Transparency = 0.8
shadow.Parent = holder

-- ---------- blocky fallback rider ----------
local block = Instance.new("Model")
block.Name = "BlockRider"
local blockPieces = {}
local blockSkis: { BasePart } = {}
local blockTips: { BasePart } = {}
local blockBoard: { BasePart } = {}
do
	local colors = { jacket = hex("e94f37"), pants = hex("2d3142"), helmet = hex("ffffff"), boot = hex("222831"), skin = hex("f1c27d"), goggle = hex("ff9f1c"), pole = hex("bfc7d1") }
	local function add(group: string, size: Vector3, pos: Vector3, color: Color3, rot: CFrame?, material: Enum.Material?)
		local p = newPart(size * S, color, material)
		p.Parent = block
		table.insert(blockPieces, { part = p, group = group, size = size, cf = CFrame.new(pos) * (rot or CFrame.identity) })
		return p
	end
	for _, sx in { -0.17, 0.17 } do
		table.insert(blockSkis, add("skis", Vector3.new(0.16, 0.05, 1.9), Vector3.new(sx, -0.875, -0.05), gear.ski))
		table.insert(blockTips, add("skis", Vector3.new(0.16, 0.05, 0.25), Vector3.new(sx, -0.83, -1.05), gear.tip, CFrame.Angles(0.5, 0, 0)))
	end
	for _, sx in { -0.15, 0.15 } do
		add("legs", Vector3.new(0.2, 0.16, 0.32), Vector3.new(sx, 0.08, -0.02), colors.boot)
		add("legs", Vector3.new(0.17, 0.5, 0.2), Vector3.new(sx, 0.4, 0), colors.pants)
	end
	add("upper", Vector3.new(0.46, 0.2, 0.28), Vector3.new(0, 0, 0), colors.pants)
	add("upper", Vector3.new(0.5, 0.55, 0.32), Vector3.new(0, 0.35, 0), colors.jacket)
	add("upper", Vector3.new(0.28, 0.28, 0.28), Vector3.new(0, 0.8, 0), colors.skin)
	add("upper", Vector3.new(0.32, 0.16, 0.32), Vector3.new(0, 0.94, 0.01), colors.helmet)
	add("upper", Vector3.new(0.3, 0.09, 0.06), Vector3.new(0, 0.82, -0.15), colors.goggle, nil, Enum.Material.Neon)
	for i, _ in { -1, 1 } do
		local g = "arm" .. i
		add(g, Vector3.new(0.13, 0.48, 0.14), Vector3.new(0, -0.22, 0), colors.jacket)
		add(g, Vector3.new(0.12, 0.1, 0.12), Vector3.new(0, -0.49, 0), colors.boot)
		add(g, Vector3.new(0.04, 1.15, 0.04), Vector3.new(0, -0.95, 0.12), colors.pole, CFrame.Angles(-0.25, 0, 0), Enum.Material.SmoothPlastic)
	end
	for _, ski in blockSkis do
		addTrail(ski, 0.07 * S, 0.85 * S)
	end
	table.insert(blockBoard, add("board", Vector3.new(0.4, 0.06, 1.35), Vector3.new(0, -0.875, 0), gear.deck))
	table.insert(blockBoard, add("board", Vector3.new(0.12, 0.02, 1.3), Vector3.new(0, -0.84, 0), gear.accent))
	addTrail(blockBoard[1], 0.18 * S, 0.62 * S, "board")
end

-- ---------- avatar rider ----------
type Avatar = {
	model: Model,
	root: BasePart,
	rootOffset: number, -- studs from the soles to the root's centre
	legLength: number,
	joints: { [string]: Motor6D },
	rest: { [string]: CFrame }, -- each joint's C0 rotation
	r15: boolean,
	skis: { BasePart },
	tips: { BasePart },
	poles: { BasePart },
	board: { [string]: BasePart },
	trails: { Trail },
	body: { BasePart }, -- everything but the skis (hidden in first person)
}
local avatar: Avatar? = nil

local JOINT_NAMES = {
	waist = { "Waist" },
	lShoulder = { "LeftShoulder", "Left Shoulder" },
	rShoulder = { "RightShoulder", "Right Shoulder" },
	lElbow = { "LeftElbow" },
	rElbow = { "RightElbow" },
	lHip = { "LeftHip" },
	rHip = { "RightHip" },
	lKnee = { "LeftKnee" },
	rKnee = { "RightKnee" },
	lAnkle = { "LeftAnkle" },
	rAnkle = { "RightAnkle" },
}

local function weld(part0: BasePart, part1: BasePart, c0: CFrame)
	local w = Instance.new("Weld")
	w.Part0, w.Part1, w.C0 = part0, part1, c0
	w.Parent = part1
end

local function buildAvatar(char: Model): Avatar?
	local hum = char:FindFirstChildOfClass("Humanoid")
	local root = char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hum or not root then
		return nil
	end
	local wasArchivable = char.Archivable
	char.Archivable = true
	local ok, copy = pcall(char.Clone, char)
	char.Archivable = wasArchivable
	if not ok or not copy then
		return nil
	end
	local model = copy :: Model
	model.Name = "RiderAvatar"
	for _, d in model:GetDescendants() do
		if d:IsA("LuaSourceContainer") or d:IsA("BillboardGui") or d:IsA("Sound") or d:IsA("ForceField") or d:IsA("Animator") then
			d:Destroy()
		end
	end
	local h = model:FindFirstChildOfClass("Humanoid") :: Humanoid
	h.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
	h.HealthDisplayType = Enum.HumanoidHealthDisplayType.AlwaysOff
	h.BreakJointsOnDeath = false
	pcall(function()
		h.RequiresNeck = false
		h.EvaluateStateMachine = false -- a puppet: no walking, falling or dying
	end)
	local r = model:FindFirstChild("HumanoidRootPart") :: BasePart
	local r15 = h.RigType == Enum.HumanoidRigType.R15

	local body = {}
	for _, p in model:GetDescendants() do
		if p:IsA("BasePart") then
			p.Anchored = false
			p.CanCollide, p.CanQuery, p.CanTouch = false, false, false
			p.Massless = true
			table.insert(body, p)
		end
	end
	r.Anchored = true
	r.Transparency = 1

	local joints, rest = {}, {}
	for key, names in JOINT_NAMES do
		for _, n in names do
			local m = model:FindFirstChild(n, true)
			if m and m:IsA("Motor6D") then
				joints[key] = m
				rest[key] = m.C0.Rotation
				break
			end
		end
	end

	local rootOffset, legLength
	if r15 then
		rootOffset = h.HipHeight + r.Size.Y / 2
		legLength = h.HipHeight
	else
		local leg = model:FindFirstChild("Left Leg") :: BasePart?
		legLength = if leg then leg.Size.Y else 2
		rootOffset = legLength + r.Size.Y / 2
	end

	-- skis under each foot, poles in each hand, and a snowboard under both feet
	local skis, tips, poles, myTrails = {}, {}, {}, {}
	for _, side in { "Left", "Right" } do
		local foot = (model:FindFirstChild(side .. "Foot") or model:FindFirstChild(side .. " Leg")) :: BasePart?
		if foot then
			local ski = newPart(Vector3.new(0.55, 0.16, 5.3), gear.ski, gear.material)
			ski.Anchored, ski.Massless, ski.Name = false, true, side .. "Ski"
			ski.Parent = model
			weld(foot, ski, CFrame.new(0, -foot.Size.Y / 2 - 0.08, -0.5))
			local tip = newPart(Vector3.new(0.55, 0.16, 0.7), gear.tip, gear.material)
			tip.Anchored, tip.Massless = false, true
			tip.Parent = model
			weld(ski, tip, CFrame.new(0, 0.12, -2.85) * CFrame.Angles(0.5, 0, 0))
			table.insert(skis, ski)
			table.insert(tips, tip)
			table.insert(myTrails, addTrail(ski, 0.2, 2.4))
		end
		local hand = (model:FindFirstChild(side .. "Hand") or model:FindFirstChild(side .. " Arm")) :: BasePart?
		if hand then
			local pole = newPart(Vector3.new(0.12, 3.4, 0.12), hex("bfc7d1"), Enum.Material.SmoothPlastic)
			pole.Anchored, pole.Massless = false, true
			pole.Parent = model
			weld(hand, pole, CFrame.new(0, -hand.Size.Y / 2, 0) * CFrame.Angles(-0.3, 0, 0) * CFrame.new(0, -1.5, 0))
			table.insert(body, pole)
			table.insert(poles, pole)
			local basket = newPart(Vector3.new(0.5, 0.06, 0.5), hex("222831"))
			basket.Anchored, basket.Massless = false, true
			basket.Parent = model
			weld(pole, basket, CFrame.new(0, -1.4, 0))
			table.insert(body, basket)
			table.insert(poles, basket)
		end
	end
	local board = {}
	local lFoot = (model:FindFirstChild("LeftFoot") or model:FindFirstChild("Left Leg")) :: BasePart?
	local hips = (model:FindFirstChild("LowerTorso") or model:FindFirstChild("Torso")) :: BasePart?
	if lFoot then
		-- centred between the feet, running along the body's sideways axis
		local half = if hips then hips.Size.X / 4 else 0.5
		local function piece(name: string, size: Vector3, c0: CFrame, color: Color3, parent: BasePart)
			local p = newPart(size, color, gear.deckMaterial)
			p.Anchored, p.Massless, p.Name = false, true, name
			p.Parent = model
			weld(parent, p, c0)
			board[name] = p
			return p
		end
		local deck = piece("Deck", Vector3.new(1.5, 0.2, 4.4), CFrame.new(half, -lFoot.Size.Y / 2 - 0.12, 0) * CFrame.Angles(0, math.pi / 2, 0), gear.deck, lFoot)
		piece("Nose", Vector3.new(1.5, 0.2, 0.8), CFrame.new(0, 0.16, -2.5) * CFrame.Angles(0.45, 0, 0), gear.deck, deck)
		piece("Tail", Vector3.new(1.5, 0.2, 0.8), CFrame.new(0, 0.16, 2.5) * CFrame.Angles(-0.45, 0, 0), gear.deck, deck)
		piece("Stripe", Vector3.new(0.36, 0.04, 4.4), CFrame.new(0, 0.11, 0), gear.accent, deck)
		for _, sz in { -1, 1 } do
			piece("Binding" .. sz, Vector3.new(1.1, 0.35, 0.6), CFrame.new(0, 0.25, sz * half * 2), gear.binding, deck)
		end
		table.insert(myTrails, addTrail(deck, 0.7, 2.2, "board"))
	end

	return {
		model = model,
		root = r,
		rootOffset = rootOffset,
		legLength = legLength,
		joints = joints,
		rest = rest,
		r15 = r15,
		skis = skis,
		tips = tips,
		poles = poles,
		board = board,
		trails = myTrails,
		body = body,
	}
end

local function styleSkis()
	local function paint(p: BasePart, color: Color3, mat: Enum.Material)
		p.Color = color
		p.Material = mat
	end
	for _, p in blockSkis do
		paint(p, gear.ski, gear.material)
	end
	for _, p in blockTips do
		paint(p, gear.tip, gear.tipMaterial)
	end
	paint(blockBoard[1], gear.deck, gear.deckMaterial)
	paint(blockBoard[2], gear.accent, gear.accentMaterial)
	local onBoard = gearType == "board"
	for _, p in blockBoard do
		p.Transparency = if onBoard then 0 else 1
	end
	for _, p in blockSkis do
		p.Transparency = if onBoard then 1 else 0
	end
	for _, p in blockTips do
		p.Transparency = if onBoard then 1 else 0
	end
	if avatar then
		for _, p in avatar.skis do
			paint(p, gear.ski, gear.material)
			p.Transparency = if onBoard then 1 else 0
		end
		for _, p in avatar.tips do
			paint(p, gear.tip, gear.tipMaterial)
			p.Transparency = if onBoard then 1 else 0
		end
		for _, p in avatar.poles do
			p.Transparency = if onBoard then 1 else 0
		end
		for name, p in avatar.board do
			if name == "Stripe" then
				paint(p, gear.accent, gear.accentMaterial)
			elseif string.sub(name, 1, 7) == "Binding" then
				paint(p, gear.binding, gear.accentMaterial)
			else
				paint(p, gear.deck, gear.deckMaterial)
			end
			p.Transparency = if onBoard then 0 else 1
		end
	end
	styleTrails()
end

-- Use a copy of this character for the rider (nil = the blocky skier).
function Rider.setAvatar(char: Model?)
	if avatar then
		for _, t in avatar.trails do
			local i = table.find(trails, t)
			if i then
				table.remove(trails, i)
			end
		end
		avatar.model:Destroy()
		avatar = nil
	end
	if char then
		avatar = buildAvatar(char)
	end
	if avatar then
		avatar.model.Parent = holder
		block.Parent = nil
	else
		block.Parent = holder
	end
	styleSkis()
	return avatar ~= nil
end

-- skiItem / trailItem / boardItem are Catalog entries
function Rider.setGear(skiItem, trailItem, boardItem)
	if boardItem then
		gear.deck = hex(boardItem.color)
		gear.accent = hex(boardItem.accent)
		gear.binding = hex(boardItem.binding)
		gear.deckMaterial = Enum.Material.SmoothPlastic
		gear.accentMaterial = if boardItem.glow then Enum.Material.Neon else Enum.Material.SmoothPlastic
	end
	if skiItem then
		gear.ski = hex(skiItem.color)
		gear.tip = hex(skiItem.tip)
		gear.material = Enum.Material.SmoothPlastic
		gear.tipMaterial = if skiItem.glow then Enum.Material.Neon else Enum.Material.SmoothPlastic
	end
	if trailItem then
		local colors = {}
		for _, c in trailItem.colors do
			table.insert(colors, hex(c))
		end
		gear.trail = colors
		gear.glow = trailItem.glow == true
	end
	styleSkis()
end

-- "skis" or "board"
function Rider.setGearType(kind: string)
	gearType = if kind == "board" then "board" else "skis"
	styleSkis()
end

-- ---------- celebrations ----------
-- Arms up after a Perfect landing: arm angles {lx, lz, rx, rz}, elbows, waist.
local CELEBRATIONS = {
	vpose = function(_t)
		return { 2.8, -0.5, 2.8, 0.5 }, 0, 0.15
	end,
}
local celebrating: { name: string, t: number }? = nil

-- strike a pose for a moment
function Rider.celebrate(name: string?)
	if name and CELEBRATIONS[name] then
		celebrating = { name = name, t = 0 }
	end
end

-- ---------- posing ----------
local shattered = false
local visible = true

local function bodyCFrame(st): CFrame
	return CFrame.new(st.x, st.y + 0.9, st.z) * CFrame.fromEulerAnglesYXZ(st.pitch, st.yaw, st.roll)
end

local function setJoint(a: Avatar, key: string, rot: CFrame)
	local m = a.joints[key]
	if m then
		-- a rotation in the parent part's space, turned into the joint's own frame
		local r = a.rest[key]
		m.Transform = r:Inverse() * rot * r
	end
end

local function poseAvatar(a: Avatar, st)
	local c = st.crouch
	-- bending the knees lowers the hips; keep the skis on the snow
	local half = a.legLength / 2
	local drop = if a.r15 then half * (1 - math.cos(0.9 * c)) + half * (1 - math.cos(0.7 * c)) else 0
	local rootLocal = CFrame.new(0, (a.rootOffset - drop) / S - 0.9, 0)
	if gearType == "board" then
		rootLocal *= BOARD_YAW
	end
	a.root.CFrame = World.toWorld(bodyCFrame(st) * rootLocal)
	a.model:SetAttribute("Air", st.air == true)
	-- arms: a celebration, flapping in the air, or whatever the ride wants
	local arms, elbow, lean = st.arms, 0.35, 0
	if celebrating then
		celebrating.t += st.dt or 0
		if celebrating.t > 1.1 then
			celebrating = nil
		else
			local pose, e, w = CELEBRATIONS[celebrating.name](celebrating.t)
			-- ease in over the first 0.15 s and out over the last 0.2 s
			local k = math.clamp(math.min(celebrating.t / 0.15, (1.1 - celebrating.t) / 0.2), 0, 1)
			arms = {
				arms[1] + (pose[1] - arms[1]) * k,
				arms[2] + (pose[2] - arms[2]) * k,
				arms[3] + (pose[3] - arms[3]) * k,
				arms[4] + (pose[4] - arms[4]) * k,
			}
			elbow += (e - elbow) * k
			lean = w * k
		end
	end
	setJoint(a, "waist", CFrame.Angles(-0.45 * c + lean, 0, 0))
	setJoint(a, "lHip", CFrame.Angles(0.9 * c, 0, 0))
	setJoint(a, "rHip", CFrame.Angles(0.9 * c, 0, 0))
	setJoint(a, "lKnee", CFrame.Angles(-1.6 * c, 0, 0))
	setJoint(a, "rKnee", CFrame.Angles(-1.6 * c, 0, 0))
	setJoint(a, "lAnkle", CFrame.Angles(0.7 * c, 0, 0))
	setJoint(a, "rAnkle", CFrame.Angles(0.7 * c, 0, 0))
	setJoint(a, "lShoulder", CFrame.Angles(arms[1], 0, arms[2]))
	setJoint(a, "rShoulder", CFrame.Angles(arms[3], 0, arms[4]))
	setJoint(a, "lElbow", CFrame.Angles(elbow, 0, 0))
	setJoint(a, "rElbow", CFrame.Angles(elbow, 0, 0))
	local hide = if st.hideUpper then 1 else 0
	for _, p in a.body do
		p.LocalTransparencyModifier = hide
	end
end

local partList, cframeList = {}, {}
local function poseBlock(st)
	local c = st.crouch
	local body = bodyCFrame(st)
	local upper = body * CFrame.new(0, -0.2 - 0.22 * c, 0) * CFrame.Angles(-0.45 * c, 0, 0)
	if gearType == "board" then
		upper *= BOARD_YAW
	end
	local stance = if gearType == "board" then BOARD_YAW else CFrame.identity
	local groups = {
		skis = { base = body, sy = 1 },
		board = { base = body, sy = 1 },
		legs = { base = body * CFrame.new(0, -0.85, 0) * stance, sy = 1 - 0.4 * c },
		upper = { base = upper, sy = 1 },
		arm1 = { base = upper * CFrame.new(-0.31, 0.56, 0) * CFrame.Angles(st.arms[1], 0, st.arms[2]), sy = 1 },
		arm2 = { base = upper * CFrame.new(0.31, 0.56, 0) * CFrame.Angles(st.arms[3], 0, st.arms[4]), sy = 1 },
	}
	table.clear(partList)
	table.clear(cframeList)
	for _, piece in blockPieces do
		local g = groups[piece.group]
		local cf = piece.cf
		if g.sy ~= 1 then
			-- squash a group vertically (legs bend when crouching)
			cf = CFrame.new(cf.X, cf.Y * g.sy, cf.Z) * cf.Rotation
			local want = Vector3.new(piece.size.X, piece.size.Y * g.sy, piece.size.Z) * S
			if (piece.part.Size - want).Magnitude > 0.01 then
				piece.part.Size = want
			end
		end
		piece.part.LocalTransparencyModifier = if st.hideUpper and piece.group ~= "skis" and piece.group ~= "board" then 1 else 0
		table.insert(partList, piece.part)
		table.insert(cframeList, World.toWorld(g.base * cf))
	end
	workspace:BulkMoveTo(partList, cframeList, Enum.BulkMoveMode.FireCFrameChanged)
end

-- st: { x, y, z, yaw, pitch, roll, crouch, arms = {lx, lz, rx, rz}, shadowY, shadowScale, showShadow, hideUpper }
function Rider.pose(st)
	if shattered or not visible then
		return
	end
	if avatar then
		poseAvatar(avatar, st)
	else
		poseBlock(st)
	end
	shadow.CFrame = World.toWorld(CFrame.new(st.x, st.shadowY + 0.03, st.z) * CFrame.Angles(0, 0, math.pi / 2))
	local ss = st.shadowScale
	shadow.Size = Vector3.new(0.02, 1.7 * ss, 1.7 * ss) * S
	shadow.Transparency = if st.showShadow then 0.8 else 1
end

-- The camera for first person: the rider's eyes.
function Rider.headCFrame(st): CFrame
	return World.toWorld(bodyCFrame(st) * CFrame.new(0, 0.7, -0.25))
end

function Rider.setTracks(on: boolean)
	local want = if gearType == "board" then "board" else "skis"
	for _, t in trails do
		t.Enabled = on and trailGear[t] == want
	end
end

function Rider.clearTracks()
	for _, t in trails do
		t:Clear()
	end
end

function Rider.setVisible(on: boolean)
	visible = on
	holder.Parent = if on then workspace else nil
end

-- ---------- crashing ----------
local wreck: Instance? = nil

-- Turn a copy of the posed avatar into a ragdoll: motors become ball sockets.
local function ragdoll(a: Avatar, base: Vector3)
	-- bake the current pose into the copy before the motors go
	local pose = {}
	for key, m in a.joints do
		pose[m] = m.Transform
	end
	local copy = a.model:Clone()
	local motors = {}
	for _, d in copy:GetDescendants() do
		if d:IsA("Motor6D") then
			table.insert(motors, d)
		end
	end
	for _, src in a.model:GetDescendants() do
		if src:IsA("Motor6D") and pose[src] then
			local twin = copy:FindFirstChild(src.Name, true)
			if twin and twin:IsA("Motor6D") then
				twin.C0 = twin.C0 * pose[src]
			end
		end
	end
	for _, m in motors do
		local p0, p1 = m.Part0, m.Part1
		if p0 and p1 and p0.Name ~= "HumanoidRootPart" then
			local a0, a1 = Instance.new("Attachment"), Instance.new("Attachment")
			a0.CFrame, a1.CFrame = m.C0, m.C1
			a0.Parent, a1.Parent = p0, p1
			local bs = Instance.new("BallSocketConstraint")
			bs.Attachment0, bs.Attachment1 = a0, a1
			bs.LimitsEnabled = true
			bs.UpperAngle = 70
			bs.TwistLimitsEnabled = true
			bs.TwistLowerAngle, bs.TwistUpperAngle = -50, 50
			bs.Parent = p1
			local nc = Instance.new("NoCollisionConstraint")
			nc.Part0, nc.Part1 = p0, p1
			nc.Parent = p1
			m:Destroy()
		end
	end
	local root = copy:FindFirstChild("HumanoidRootPart")
	if root then
		root:Destroy()
	end
	for _, p in copy:GetDescendants() do
		if p:IsA("BasePart") then
			p.Anchored = false
			p.Massless = false
			p.LocalTransparencyModifier = 0
			-- limbs hit the snow; hats and hair just come along
			p.CanCollide = p.Parent == copy
		end
	end
	copy.Parent = workspace
	for _, p in copy:GetDescendants() do
		if p:IsA("BasePart") then
			p.AssemblyLinearVelocity = base + Vector3.new(Util.rand(-4, 4), Util.rand(8, 14), Util.rand(-4, 4))
			p.AssemblyAngularVelocity = Vector3.new(Util.rand(-10, 10), Util.rand(-10, 10), Util.rand(-10, 10))
		end
	end
	return copy
end

-- the blocky skier just comes apart
local function shatterBlock(base: Vector3)
	local m = Instance.new("Model")
	m.Name = "Wreck"
	for _, piece in blockPieces do
		local bit = piece.part:Clone()
		bit:ClearAllChildren()
		bit.Anchored = false
		bit.CanCollide = true
		bit.Parent = m
	end
	m.Parent = workspace
	for _, bit in m:GetChildren() do
		local p = bit :: BasePart
		p.AssemblyLinearVelocity = base * Util.rand(0.35, 0.7) + Vector3.new(Util.rand(-6, 6), Util.rand(6, 16), Util.rand(-6, 6))
		p.AssemblyAngularVelocity = Vector3.new(Util.rand(-14, 14), Util.rand(-14, 14), Util.rand(-14, 14))
	end
	return m
end

-- `vel` is the rider's simulation-space velocity.
function Rider.shatter(vel: Vector3)
	if shattered then
		return
	end
	shattered = true
	Rider.setTracks(false)
	shadow.Transparency = 1
	local base = World.SLOPE:VectorToWorldSpace(vel * S) * 0.6
	local ok, result = pcall(function()
		return if avatar then ragdoll(avatar, base) else shatterBlock(base)
	end)
	if ok then
		wreck = result
		Debris:AddItem(result, 12)
	else
		warn("[PeakFlip] ragdoll failed:", result)
	end
	holder.Parent = nil
end

function Rider.rebuild()
	if wreck then
		wreck:Destroy()
		wreck = nil
	end
	shattered = false
	if visible then
		holder.Parent = workspace
	end
	Rider.clearTracks()
end

function Rider.isShattered(): boolean
	return shattered
end

function Rider.hasAvatar(): boolean
	return avatar ~= nil
end

block.Parent = holder
styleSkis()

return Rider
