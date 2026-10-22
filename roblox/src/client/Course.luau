-- Endless course generation, ported from game.js: features are spawned ahead of the rider and
-- removed once they're behind. Everything here lives in simulation space (see World).
local Tuning = require(script.Parent.Tuning)
local Util = require(script.Parent.Util)
local World = require(script.Parent.World)
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Theme = require(ReplicatedStorage:WaitForChild("PeakFlip"):WaitForChild("Theme"))

local G = Tuning.G
local clamp, rand, sign = Util.clamp, Util.rand, Util.sign
local hex = Color3.fromHex

local Course = {
	ramps = {},
	rails = {},
	obstacles = {},
	coins = {},
	crevasses = {},
	pads = {},
	shapes = {},
	movers = {},
	decor = {},
	spawnZ = 0,
	decorZ = 0,
}

-- the slope uses the same few colours as everything else (see shared/Theme)
local C = {
	snow = Theme.snow,
	ramp = hex("e9f1f8"),
	rampEdge = Theme.primary,
	rail = Theme.primary,
	railPost = hex("5b6676"),
	trunk = Theme.woodDark,
	needles = { hex("2f6b4f"), hex("377a5a"), hex("2f6b4f") },
	spruce = { hex("2f6b4f"), hex("2a5e46") },
	rock = hex("8b95a3"),
	log = Theme.wood,
	crevasse = hex("1d3f66"),
	ice = { hex("cfeeff"), hex("b6e2fb"), hex("e9f7ff") },
	warn = Theme.gold,
	coin = Theme.gold,
	table = hex("e9f1f8"),
	boostBase = Theme.ink,
	boostEdge = Theme.primary,
	chev = hex("9ccaff"),
	frame = Theme.ink,
	tramp = Theme.gold,
	leg = hex("5b6676"),
	mountains = { hex("eef3f8"), hex("dbe4ee"), hex("c8d4e1") },
}
Course.colors = C

-- ---------- course RNG and the always-open lane ----------
local rng = Random.new()
local function wr(a: number, b: number): number
	return a + rng:NextNumber() * (b - a)
end
local function crng(): number
	return rng:NextNumber()
end

local laneSeed = { 0, 0 }
-- A smooth, always-steerable lane that hazards can't fill, so every section has a way through.
local function laneX(z: number): number
	local X = Tuning.X_LIMIT
	return clamp(math.sin(z * 0.02 + laneSeed[1]) * 7 + math.sin(z * 0.05 + laneSeed[2]) * 2.5, -X + 2.5, X - 2.5)
end
local function inLane(x: number, z: number, r: number): boolean
	return math.abs(x - laneX(z)) < 2.2 + r
end
Course.laneX = laneX

-- ---------- side banks ----------
local BANK_IN, BANK_ANGLE = 16, 0.42
local BANK_TAN = math.tan(BANK_ANGLE)
local function bankH(x: number): number
	return math.max(0, math.abs(x) - BANK_IN) * BANK_TAN
end

-- ---------- terrain queries used by the physics ----------
function Course.groundAt(x: number, z: number): (number, number)
	for _, c in Course.crevasses do
		if z <= c.z0 and z >= c.z0 - c.L and math.abs(x) < 15.5 then
			return -30, 0
		end
	end
	local h, s = 0, 0
	for _, sh in Course.shapes do
		if z <= sh.z0 and z >= sh.z0 - sh.L and math.abs(x - sh.x) <= sh.W / 2 then
			local hh, dh = sh.fn((sh.z0 - z) / sh.L)
			if hh > h then
				h, s = hh, dh / sh.L
			end
		end
	end
	for _, r in Course.ramps do
		if z <= r.z0 and z >= r.z0 - r.L and math.abs(x - r.x) <= r.W / 2 then
			local t = (r.z0 - z) / r.L
			local hh = r.H * t * t
			if hh > h then
				h, s = hh, 2 * r.H * t / r.L
			end
		end
	end
	return h, s
end

function Course.padAt(x: number, z: number, kind: string)
	for _, q in Course.pads do
		if q.kind == kind and math.abs(q.z - z) < q.len and math.abs(q.x - x) < q.r then
			return q
		end
	end
	return nil
end

function Course.railAt(x: number, z: number)
	for _, r in Course.rails do
		if z <= r.z0 and z >= r.z0 - r.L and math.abs(x - r.x) < 0.8 then
			return r
		end
	end
	return nil
end

-- ---------- builders ----------
local function addRamp(x: number, z0: number, L: number, H: number, W: number)
	L = math.round(L * 2) / 2
	H = math.round(H * 4) / 4
	local m = World.model("Ramp")
	World.profile(m, x, z0, L, W, function(t)
		return H * t * t
	end, 8, C.ramp)
	World.part(m, Vector3.new(W + 0.05, 0.1, 0.35), CFrame.new(x, H - 0.02, z0 - L + 0.15), C.rampEdge)
	for _, sx in { -1, 1 } do
		World.part(m, Vector3.new(0.12, 0.12, L * 0.95), CFrame.new(x + sx * W / 2, 0.06, z0 - L / 2), C.rampEdge)
	end
	table.insert(Course.ramps, { x = x, z0 = z0, L = L, H = H, W = W, model = m })
end

local function addRail(x: number, z0: number, L: number, top: number?)
	local h = top or 0.9
	local m = World.model("Rail")
	World.part(m, Vector3.new(0.16, 0.14, L), CFrame.new(x, h, z0 - L / 2), C.rail)
	for _, pz in { -0.4, -L / 2, -L + 0.4 } do
		World.part(m, Vector3.new(0.1, h, 0.1), CFrame.new(x, h / 2, z0 + pz), C.railPost)
	end
	table.insert(Course.rails, { x = x, z0 = z0, L = L, top = h, model = m })
end

local WEDGE_FLIP = CFrame.Angles(0, math.pi, 0)
-- A low-poly spruce: each tier is two crossed roofs of wedges.
local function buildTree(parent: Instance, x: number, y: number, z: number, s: number, ry: number, tiers, trunk: Color3?)
	local base = CFrame.new(x, y, z) * CFrame.Angles(0, ry, 0)
	World.part(parent, Vector3.new(0.35, 1, 0.35) * s, base * CFrame.new(0, 0.5 * s, 0), trunk or C.trunk, { shadow = false })
	for _, tier in tiers do
		local r, h, ty, color = tier[1] * s, tier[2] * s, tier[3] * s, tier[4]
		for k = 0, 1 do
			local cross = base * CFrame.new(0, ty, 0) * CFrame.Angles(0, k * math.pi / 2, 0)
			World.part(parent, Vector3.new(r * 1.6, h, r), cross * CFrame.new(0, 0, -r / 2), color, { class = "WedgePart" })
			World.part(parent, Vector3.new(r * 1.6, h, r), cross * CFrame.new(0, 0, r / 2) * WEDGE_FLIP, color, { class = "WedgePart" })
		end
	end
end

local OBSTACLE_TIERS = {
	{ 1.35, 1.9, 1.65, C.needles[1] },
	{ 1.05, 1.6, 2.55, C.needles[2] },
	{ 0.7, 1.3, 3.35, C.needles[3] },
	{ 0.33, 0.5, 3.9, C.snow },
}
local SCENERY_TIERS = {
	{
		{ 1.5, 1.9, 1.5, C.spruce[1] },
		{ 1.1, 1.7, 2.45, C.snow },
		{ 0.75, 1.5, 3.25, C.spruce[1] },
		{ 0.38, 0.9, 3.95, C.snow },
	},
	{
		{ 1.25, 1.9, 1.5, C.spruce[2] },
		{ 0.95, 1.8, 2.5, C.spruce[2] },
		{ 0.62, 1.6, 3.4, C.snow },
		{ 0.34, 1.1, 4.2, C.spruce[2] },
	},
}

local function addTree(x: number, z: number, s: number)
	x = clamp(x, -Tuning.X_LIMIT + 0.5, Tuning.X_LIMIT - 0.5)
	if inLane(x, z, 0.55 * s) then
		return
	end
	local m = World.model("Tree")
	buildTree(m, x, 0, z, s, rand(0, 6), OBSTACLE_TIERS)
	table.insert(Course.obstacles, { kind = "tree", x = x, z = z, r = 0.55 * s, h = 3.8 * s, model = m })
end

local function addRock(x: number, z: number, s: number)
	x = clamp(x, -Tuning.X_LIMIT + 0.5, Tuning.X_LIMIT - 0.5)
	if inLane(x, z, s) then
		return
	end
	local m = World.model("Rock")
	local cf = CFrame.new(x, 0.3 * s, z) * CFrame.Angles(rand(-0.3, 0.3), rand(0, 6), rand(-0.3, 0.3))
	World.part(m, Vector3.new(1.9, 1.3, 1.7) * s, cf, C.rock)
	World.part(m, Vector3.new(1.4, 0.35, 1.25) * s, cf * CFrame.new(0, 0.7 * s, 0), C.snow, nil)
	table.insert(Course.obstacles, { kind = "rock", x = x, z = z, r = 1.0 * s, h = 1.0 * s, model = m })
end

local function addLog(x: number, z: number, hw: number)
	local m = World.model("Log")
	World.part(m, Vector3.new(hw * 2, 0.6, 0.6), CFrame.new(x, 0.3, z), C.log, { shape = Enum.PartType.Cylinder })
	World.part(m, Vector3.new(hw * 2 - 0.2, 0.1, 0.4), CFrame.new(x, 0.62, z), C.snow, nil)
	-- forgiving: any hop clears it
	table.insert(Course.obstacles, { kind = "log", x = x, z = z, hw = hw, r = 0.4, h = 0.45, model = m })
end

local function addBall(z: number)
	local m = World.model("Snowball")
	local o = { kind = "ball", x = wr(-10, 10), z = z, r = 1.15, h = 2.3, vx = (if crng() < 0.5 then -1 else 1) * wr(5, 8), model = m, spin = 0 }
	o.part = World.part(m, Vector3.new(2.3, 2.3, 2.3), CFrame.new(o.x, 1.15, z), C.snow, { shape = Enum.PartType.Ball })
	table.insert(Course.obstacles, o)
	table.insert(Course.movers, o)
end

local function addCrevasse(z0: number, L: number)
	local m = World.model("Crevasse")
	World.part(m, Vector3.new(31, 0.06, L), CFrame.new(0, 0.03, z0 - L / 2), C.crevasse, { shadow = false })
	World.part(m, Vector3.new(31, 0.05, L * 0.8), CFrame.new(0, 0.07, z0 - L / 2), hex("12476e"), { shadow = false, material = Enum.Material.Glass, transparency = 0.4 })
	-- a snow lip on each edge with ice teeth leaning out over the drop
	for _, e in { { z0, -1 }, { z0 - L, 1 } } do
		local ez, toward = e[1], e[2]
		World.part(m, Vector3.new(31, 0.28, 0.9), CFrame.new(0, 0.12, ez + toward * 0.15), C.snow, nil)
		local x = -15.2
		while x < 15.5 do
			local h = rand(0.4, 1.4)
			local cf = CFrame.new(x, h / 2 + 0.1, ez + toward * rand(0.2, 0.55)) * CFrame.Angles(toward * rand(0.25, 0.6), rand(0, 3), rand(-0.25, 0.25))
			World.part(m, Vector3.new(rand(0.3, 0.5), h, rand(0.3, 0.5)), cf, C.ice[math.random(1, 3)], { shadow = false })
			x += rand(1.0, 1.6)
		end
	end
	-- warning poles with tape, just outside the run
	for _, sx in { -1, 1 } do
		for _, pz in { 7, 0.6 } do
			World.part(m, Vector3.new(0.12, 1.4, 0.12), CFrame.new(sx * 14.2, 0.7, z0 + pz), C.warn)
		end
		World.part(m, Vector3.new(0.04, 0.22, 6.4), CFrame.new(sx * 14.2, 1.2, z0 + 3.8), C.warn, { material = Enum.Material.Neon })
	end
	table.insert(Course.crevasses, { z0 = z0, L = L, model = m, passed = false })
end

local coinRot = CFrame.Angles(0, math.pi / 2, 0)
local function addCoin(x: number, y: number, z: number)
	local p = World.part(World.folder, Vector3.new(0.14, 1.0, 1.0), CFrame.new(x, y, z) * coinRot, C.coin, {
		shape = Enum.PartType.Cylinder,
		material = Enum.Material.Neon,
		shadow = false,
	})
	p.Name = "Coin"
	table.insert(Course.coins, { x = x, y = y, z = z, part = p, taken = false })
end
Course.addCoin = addCoin

-- ---------- smooth terrain: rollers and tabletops ----------
-- each fn(t) returns height and d(height)/dt
local function bump(H: number)
	return function(t: number)
		return H * math.sin(math.pi * t) ^ 2, H * math.pi * math.sin(2 * math.pi * t)
	end
end
local function tableTop(H: number, a: number, b: number)
	return function(t: number)
		if t < a then
			return H * (t / a) ^ 2, 2 * H * (t / a) / a
		elseif t < b then
			return H, 0
		end
		return H * (1 - (t - b) / (1 - b)), -H / (1 - b)
	end
end

local function addShape(x: number, z0: number, L: number, W: number, fn, color: Color3, edges: boolean, material: Enum.Material?)
	local m = World.model("Terrain")
	World.profile(m, x, z0, L, W, function(t)
		return (fn(t))
	end, math.clamp(math.floor(L / 2.5), 8, 20), color, material)
	if edges then
		for _, sx in { -1, 1 } do
			World.part(m, Vector3.new(0.14, 0.14, L), CFrame.new(x + sx * W / 2, 0.05, z0 - L / 2), C.rampEdge)
		end
	end
	table.insert(Course.shapes, { x = x, z0 = z0, L = L, W = W, fn = fn, model = m })
end

-- ---------- pads: boost strips and trampolines ----------
local upright = CFrame.Angles(0, 0, math.pi / 2) -- cylinders run along X; stand them up
local function addPad(kind: string, x: number, z: number)
	local m = World.model(if kind == "bounce" then "Trampoline" else "Boost")
	local pad = { kind = kind, x = x, z = z, r = if kind == "bounce" then 2.3 else 1.6, len = if kind == "bounce" then 2.6 else 2.5, model = m, used = false, glow = {} }
	if kind == "bounce" then
		local H = 0.32
		for i = 0, 5 do
			local a = i / 6 * Util.TAU
			World.part(m, Vector3.new(0.16, H, 0.16), CFrame.new(x + math.cos(a) * 1.8, H / 2, z + math.sin(a) * 1.8), C.leg)
		end
		World.part(m, Vector3.new(0.18, 4, 4), CFrame.new(x, H - 0.02, z) * upright, C.frame, { shape = Enum.PartType.Cylinder })
		World.part(m, Vector3.new(0.06, 2.8, 2.8), CFrame.new(x, H + 0.08, z) * upright, C.tramp, { shape = Enum.PartType.Cylinder })
		-- an up arrow floating above it
		for k = 0, 1 do
			for _, sx in { -1, 1 } do
				local cf = CFrame.new(x + sx * 0.32, 1.4 + k * 0.7, z) * CFrame.Angles(0, 0, -sx * 0.75)
				table.insert(pad.glow, World.part(m, Vector3.new(0.9, 0.16, 0.16), cf, C.tramp, { material = Enum.Material.Neon, shadow = false }))
			end
		end
	else
		World.part(m, Vector3.new(3.2, 0.07, 5), CFrame.new(x, 0.035, z), C.boostBase)
		for _, sx in { -1, 1 } do
			World.part(m, Vector3.new(0.16, 0.1, 5), CFrame.new(x + sx * 1.6, 0.05, z), C.boostEdge, { material = Enum.Material.Neon })
		end
		for row, cz in { 1.6, 0, -1.6 } do
			local arms = {}
			for _, sx in { -1, 1 } do
				-- the arms meet at the front (downhill), so the arrow points the way you're going
				local cf = CFrame.new(x + sx * 0.46, 0.09, z + cz) * CFrame.Angles(0, -sx * 0.6, 0)
				table.insert(arms, World.part(m, Vector3.new(1.25, 0.06, 0.34), cf, C.chev, { material = Enum.Material.Neon, shadow = false }))
			end
			pad.glow[row] = arms
		end
	end
	table.insert(Course.pads, pad)
end
Course.addPad = addPad

local dark = hex("2a5a66")
function Course.animatePads(time: number)
	for _, q in Course.pads do
		if q.kind == "bounce" then
			local u = (time * 1.4) % 1
			for i, p in q.glow do
				p.Transparency = 0.15 + 0.6 * ((u + (if i > 2 then 0.5 else 0)) % 1)
			end
		else
			for row, arms in q.glow do
				local k = math.max(0, math.sin(time * 9 - row * 1.3))
				local col = dark:Lerp(C.chev, 0.25 + 0.75 * k)
				for _, p in arms do
					p.Color = col
				end
			end
		end
	end
end

-- ---------- features (each returns the length it used up) ----------
local function lipSpeed(sp: number, H: number): number
	return math.sqrt(math.max(64, sp * sp - 2 * 0.35 * G * H))
end
local function airTime(sp: number, H: number, L: number): number
	local v = lipSpeed(sp, H)
	local vy = v * 2 * H / L
	local up, apex = vy / G, H + vy * vy / (2 * G)
	return up + math.sqrt(2 * apex / (G * 1.15))
end
local function arcY(sp: number, H: number, L: number, t: number): number
	local v = lipSpeed(sp, H)
	local vy = v * 2 * H / L
	local up = vy / G
	if t < up then
		return H + vy * t - G * t * t / 2
	end
	local apex, f = H + vy * vy / (2 * G), t - up
	return apex - G * 1.15 * f * f / 2
end
local function bounceAirTime(vy: number): number
	local up, apex = vy / G, vy * vy / (2 * G)
	return up + math.sqrt(2 * apex / (G * 1.15))
end

local function featureRamp(z: number, big: boolean, sp: number): number
	local L = if big then wr(10, 12) else wr(6, 8)
	local H = if big then wr(3.6, 4.6) else wr(1.9, 2.7)
	local W = if big then 7 else 5
	local x = wr(-8, 8)
	addRamp(x, z, L, H, W)
	if big and crng() < 0.4 then
		addPad("boost", x, z + 12)
	end
	local at, ls = airTime(sp, H, L), lipSpeed(sp, H)
	if crng() < 0.75 then
		for i = 1, 6 do
			local t = at * i / 7
			addCoin(x, arcY(sp, H, L, t) + 1.2, z - L - ls * t)
		end
	end
	if not big and crng() < 0.35 then
		local x2 = if x > 0 then x - wr(8, 12) else x + wr(8, 12)
		if math.abs(x2) < 12 then
			addRamp(x2, z - wr(-4, 4), wr(6, 8), wr(1.9, 2.7), 5)
		end
	end
	return L + ls * at + 22
end

local function featureRail(z: number, sp: number, withKicker: boolean): number
	local x, L = wr(-7, 7), wr(12, 22)
	addRail(x, z, L)
	for i = 1, math.ceil(L / 3) - 1 do
		addCoin(x, 2.2, z - i * 3)
	end
	local len = L + 20
	if withKicker then
		addRamp(x, z - L - 12, 7, 2.25, 5)
		len += 12 + 7 + sp * airTime(sp, 2.25, 7)
	end
	return len
end

local function featureRocks(z: number, d: number): number
	for _ = 1, 5 + math.floor(d * 10) do
		addRock(wr(-12, 12), z - wr(0, 32), wr(0.7, 1.3))
	end
	return 45
end

local function featureSlalom(z: number, d: number): number
	local n = 4 + math.floor(d * 7)
	for i = 0, n - 1 do
		addTree((if i % 2 == 1 then 1 else -1) * wr(1.5, 9), z - i * 9, wr(0.8, 1.1))
	end
	for i = 0, n - 1 do
		addCoin(math.sin(i * 1.2) * 3, 1.2, z - i * 9 - 4.5)
	end
	return n * 9 + 18
end

local function featureCoinSnake(z: number): number
	local x0 = wr(-6, 6)
	for i = 0, 13 do
		addCoin(x0 + math.sin(i * 0.45) * 4, 1.2, z - i * 3)
	end
	return 50
end

local function featureCrevasse(z: number, d: number): number
	local L = math.round(4 + d * 5 + wr(0, 2))
	addCrevasse(z - 8, L)
	for i = 0, 3 do
		addCoin(wr(-8, 8), 2.6, z - 8 - L * (i + 0.5) / 4)
	end
	return L + 38
end

local function featureLogs(z: number, d: number): number
	local n = 2 + math.floor(d * 3)
	for i = 0, n - 1 do
		local hw = wr(3, 5 + d * 3)
		local x = clamp(wr(-10, 10), -13 + hw, 13 - hw)
		addLog(x, z - i * 14, hw)
		addCoin(x, 2.3, z - i * 14)
	end
	return n * 14 + 22
end

local function featureBalls(z: number, d: number): number
	local n = 1 + math.floor(d * 2.5)
	for i = 0, n - 1 do
		addBall(z - i * 16)
	end
	return n * 16 + 24
end

local function featureField(z: number, d: number): number
	for _ = 1, 10 + math.floor(d * 16) do
		local zz = z - wr(0, 60)
		if crng() < 0.5 then
			addRock(wr(-12, 12), zz, wr(0.7, 1.2))
		else
			addTree(wr(-12, 12), zz, wr(0.8, 1.1))
		end
	end
	return 70
end

local function featureMega(z: number, sp: number): number
	local L, H, W, x = 16, 7, 9, wr(-4, 4)
	addPad("boost", x, z + 14)
	addRamp(x, z, L, H, W)
	local at, ls = airTime(sp + 6, H, L), lipSpeed(sp + 6, H)
	for i = 1, 9 do
		local t = at * i / 10
		addCoin(x, arcY(sp + 6, H, L, t) + 1.2, z - L - ls * t)
	end
	return L + ls * at + 30
end

local function featureKickerLine(z: number, sp: number): number
	local x, zz = wr(-7, 7), z
	for _ = 1, 3 do
		local L, H = 6.5, 2.25
		addRamp(x, zz, L, H, 5)
		local at, ls = airTime(sp, H, L), lipSpeed(sp, H)
		for k = 1, 4 do
			local t = at * k / 5
			addCoin(x, arcY(sp, H, L, t) + 1.2, zz - L - ls * t)
		end
		zz -= L + ls * at + 9
	end
	return z - zz + 14
end

local function featureBounce(z: number): number
	-- a line of trampolines spaced so each bounce lands you on the next; coin arcs over every hop
	local n = 3 + (if crng() < 0.4 then 1 else 0)
	local x, sp = wr(-6, 6), Tuning.baseSpeed(-z) * 1.08
	local zz = z
	for i = 0, n - 1 do
		addPad("bounce", x, zz)
		if i == n - 1 then
			break
		end
		-- you ride onto the first one from its near edge; after that you take off where you landed (its middle).
		-- Air drag costs ~0.6 m/s per second, so the hop is a little shorter than speed x time.
		local from = if i == 0 then zz + 2.4 else zz
		local vy = Tuning.bounceVy(i)
		local T = bounceAirTime(vy)
		local dist = (sp - 0.3 * T) * T
		for k = 1, 5 do
			local t = T * k / 6
			local y = if t < vy / G then vy * t - G * t * t / 2 else vy * vy / (2 * G) - G * 1.15 * (t - vy / G) ^ 2 / 2
			addCoin(x, y + 1.6, from - sp * t)
		end
		zz = from - dist
	end
	return z - zz + 40
end

local function featureBoost(z: number, d: number): number
	local x = wr(-8, 8)
	addPad("boost", x, z)
	addPad("boost", x + wr(-2, 2), z - 10)
	for i = 0, 7 do
		addCoin(x, 1.2, z - 14 - i * 3)
	end
	if d > 0.2 then
		for _ = 1, 3 do
			addRock(wr(-12, 12), z - wr(20, 40), wr(0.7, 1))
		end
	end
	return 48
end

local function featureRollers(z: number, d: number): number
	local n = 3 + math.floor(crng() * 3)
	local zz = z
	for _ = 1, n do
		local L, H = wr(13, 18), wr(1.2, 1.8 + d)
		addShape(0, zz, L, 34, bump(H), C.snow, false)
		addCoin(wr(-6, 6), H + 2.2, zz - L / 2)
		zz -= L
	end
	return z - zz + 16
end

local function featureTabletop(z: number, d: number): number
	local H, L, x, W = wr(2.2, 2.8 + d), wr(40, 48), wr(-6, 6), 9
	addShape(x, z, L, W, tableTop(H, 0.36, 0.55), C.table, true)
	for i = 0, 5 do
		addCoin(x, H + 1.6 + math.sin(i / 5 * math.pi) * 1.6, z - L * (0.36 + i * 0.07))
	end
	return L + 22
end

local function featureStepDown(z: number): number
	-- big kicker into a long downhill landing: huge hang time, soft landing
	local x = wr(-5, 5)
	addRamp(x, z, 8, 2.6, 7)
	addShape(x, z - 8 - 6, 46, 14, tableTop(3.2, 0.28, 0.3), C.table, true)
	return 8 + 6 + 46 + 18
end

local function pickFeature(d: number): string
	local w = {
		{ "ramp", 16 },
		{ "big", 10 },
		{ "rollers", 9 },
		{ "table", 8 },
		{ "stepdown", if d > 0.05 then 5 else 0 },
		{ "mega", if d > 0.1 then 4 else 0 },
		{ "line", 7 },
		{ "bounce", 6 },
		{ "boost", 5 },
		{ "rail", 10 },
		{ "railKick", 7 },
		{ "rocks", 12 + 10 * d },
		{ "slalom", 10 + 6 * d },
		{ "snake", 6 - 4 * d },
		{ "crevasse", if d > 0.05 then 7 + 10 * d else 0 },
		{ "logs", if d > 0.02 then 6 + 10 * d else 0 },
		{ "balls", if d > 0.12 then 12 * d else 0 },
		{ "field", if d > 0.2 then 12 * d else 0 },
	}
	local total = 0
	for _, e in w do
		total += e[2]
	end
	local r = crng() * total
	for _, e in w do
		r -= e[2]
		if r < 0 then
			return e[1]
		end
	end
	return "ramp"
end

local OPEN_FEATURES = { ramp = true, big = true, railKick = true, crevasse = true, mega = true, line = true, bounce = true, table = true, stepdown = true, rollers = true }

local function spawnFeature()
	local z = Course.spawnZ
	local D = -z
	local d = clamp(D / Tuning.RAMP_UP, 0, 1)
	local sp = Tuning.baseSpeed(D)
	local k = pickFeature(d)
	local len
	if k == "ramp" then
		len = featureRamp(z, false, sp)
	elseif k == "big" then
		len = featureRamp(z, true, sp)
	elseif k == "rail" then
		len = featureRail(z, sp, false)
	elseif k == "railKick" then
		len = featureRail(z, sp, true)
	elseif k == "rocks" then
		len = featureRocks(z, d)
	elseif k == "slalom" then
		len = featureSlalom(z, d)
	elseif k == "snake" then
		len = featureCoinSnake(z)
	elseif k == "crevasse" then
		len = featureCrevasse(z, d)
	elseif k == "logs" then
		len = featureLogs(z, d)
	elseif k == "balls" then
		len = featureBalls(z, d)
	elseif k == "field" then
		len = featureField(z, d)
	elseif k == "rollers" then
		len = featureRollers(z, d)
	elseif k == "table" then
		len = featureTabletop(z, d)
	elseif k == "stepdown" then
		len = featureStepDown(z)
	elseif k == "mega" then
		len = featureMega(z, sp)
	elseif k == "line" then
		len = featureKickerLine(z, sp)
	elseif k == "bounce" then
		len = featureBounce(z)
	else
		len = featureBoost(z, d)
	end
	-- extra scattered hazards get more common the further you go
	if not OPEN_FEATURES[k] and crng() < (0.2 + d * 0.8) * Tuning.EXTRA_HAZARDS then
		for _ = 1, 1 + math.floor(d * 5 * Tuning.EXTRA_HAZARDS) do
			addRock(wr(-12, 12), z - wr(5, len - 5), wr(0.6, 1))
		end
	end
	Course.spawnZ -= len
end

-- ---------- scenery: snow banks and spruce groves beside the run ----------
local BANK_CHUNK = 40
local bankZ = 40
local function addBankChunk(z0: number)
	local m = World.model("Bank")
	local span, thick = 140, 4
	for _, s in { -1, 1 } do
		local a = s * BANK_ANGLE
		local cx, cy = s * (BANK_IN + math.cos(BANK_ANGLE) * span / 2), math.sin(BANK_ANGLE) * span / 2
		-- drop the slab by half its thickness along its own up direction so its top face is the bank surface
		local nx, ny = -s * math.sin(BANK_ANGLE), math.cos(BANK_ANGLE)
		local cf = CFrame.new(cx - nx * thick / 2, cy - ny * thick / 2, z0 - BANK_CHUNK / 2) * CFrame.Angles(0, 0, a)
		World.part(m, Vector3.new(span, thick, BANK_CHUNK + 0.2), cf, C.snow, { shadow = false })
	end
	table.insert(Course.decor, { z = z0 - BANK_CHUNK, model = m })
end

local function spawnDecor(z: number)
	for _, s in { -1, 1 } do
		if Util.chance(if Course.lowGfx then 0.25 else 0.75) then
			local x = s * rand(17.5, 70)
			local zz = z - rand(0, 4)
			local m = World.model("Spruce")
			buildTree(m, x, bankH(x) - 0.2, zz, rand(1.0, 2.2), rand(0, 6), SCENERY_TIERS[math.random(1, 2)], hex("66554a"))
			table.insert(Course.decor, { z = zz, model = m })
		end
	end
end

-- far peaks that travel with the camera
local mountains: Model? = nil
local function buildMountains()
	local m = Instance.new("Model")
	m.Name = "Mountains"
	local pivot = Instance.new("Part")
	pivot.Anchored, pivot.CanCollide, pivot.CanQuery, pivot.CanTouch = true, false, false, false
	pivot.Transparency, pivot.Size = 1, Vector3.one
	pivot.Parent = m
	m.PrimaryPart = pivot
	local pr = Random.new(7)
	-- A cube balanced on its corner reads as a low-poly peak once its lower half is out of sight.
	-- These axes put the cube's local (1, 1, -1) corner straight up.
	local s3, s6 = math.sqrt(3), math.sqrt(6)
	local onCorner = CFrame.fromMatrix(Vector3.zero, Vector3.new(math.sqrt(2 / 3), 1 / s3, 0), Vector3.new(-1 / s6, 1 / s3, 1 / math.sqrt(2)))
	local topCorner = Vector3.new(1, 1, -1)
	for i = 1, 26 do
		local size = pr:NextNumber(260, 620)
		local x = pr:NextNumber(-1500, 1500)
		local z = -pr:NextNumber(1300, 2100)
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
		p.Material = Enum.Material.SmoothPlastic
		p.Color = C.mountains[(i % 3) + 1]
		p.Size = Vector3.one * size
		p.CFrame = CFrame.new(x, -size * pr:NextNumber(0.25, 0.45) - 200, z) * CFrame.Angles(0, pr:NextNumber(0, 6), 0) * onCorner
		p.Parent = m
		-- a snow cap: a smaller cube sharing the peak's top corner
		local cap = p:Clone()
		local capSize = size * 0.32
		cap.Color = Color3.new(1, 1, 1)
		cap.Size = Vector3.one * capSize
		cap.CFrame = p.CFrame * CFrame.new(topCorner * ((size - capSize) / 2 + 0.6)) -- nudged out so the faces don't flicker
		cap.Parent = m
	end
	m.Parent = workspace
	return m
end

-- ground under the run, moved along with the rider
local ground: BasePart? = nil
Course.lowGfx = false -- fewer scenery trees

function Course.init()
	ground = World.part(World.folder, Vector3.new(34, 1, 700), CFrame.new(0, -0.5, 0), C.snow, { shadow = false })
	ground.Name = "Ground"
	ground.CanCollide = true -- the pieces of a crashed rider land on it
	ground.Parent = workspace -- survives clear()
	mountains = buildMountains()
end

-- hide the whole run (while in the lobby)
function Course.setVisible(on: boolean)
	local parent = if on then workspace else nil
	World.folder.Parent = parent
	if ground then
		ground.Parent = parent
	end
	if mountains then
		mountains.Parent = parent
	end
end

function Course.clear()
	World.folder:ClearAllChildren()
	for _, key in { "ramps", "rails", "obstacles", "coins", "crevasses", "pads", "shapes", "movers", "decor" } do
		table.clear(Course[key])
	end
end

-- Build a fresh run. `startZ` is where the first feature goes (just ahead of the start).
function Course.reset()
	Course.clear()
	World.originZ = 0
	rng = Random.new()
	laneSeed = { crng() * 6.28, crng() * 6.28 }
	Course.spawnZ = -55
	Course.decorZ = 30
	bankZ = 40
end

-- Keep the course built out to VIEW ahead of pz and drop what's 30 m behind.
function Course.update(pz: number)
	while Course.spawnZ > pz - Tuning.VIEW do
		spawnFeature()
	end
	while bankZ > pz - Tuning.VIEW - 40 do
		addBankChunk(bankZ)
		bankZ -= BANK_CHUNK
	end
	while Course.decorZ > pz - Tuning.VIEW do
		spawnDecor(Course.decorZ)
		Course.decorZ -= 4
	end
	local behind = pz + 30
	local function keep(list, zOf, kill)
		local j = 0
		for i = 1, #list do
			local o = list[i]
			if zOf(o) > behind then
				kill(o)
			else
				j += 1
				list[j] = o
			end
		end
		for i = #list, j + 1, -1 do
			list[i] = nil
		end
	end
	local function destroy(o)
		if o.model then
			o.model:Destroy()
		end
	end
	keep(Course.ramps, function(r)
		return r.z0 - r.L
	end, destroy)
	keep(Course.rails, function(r)
		return r.z0 - r.L
	end, destroy)
	keep(Course.obstacles, function(o)
		return o.z
	end, destroy)
	keep(Course.movers, function(o)
		return o.z
	end, function() end)
	keep(Course.crevasses, function(c)
		return c.z0 - c.L
	end, destroy)
	keep(Course.pads, function(q)
		return q.z - 3
	end, destroy)
	keep(Course.shapes, function(q)
		return q.z0 - q.L
	end, destroy)
	keep(Course.decor, function(o)
		return o.z
	end, destroy)
	keep(Course.coins, function(c)
		return c.z
	end, function(c)
		if c.part then
			c.part:Destroy()
		end
	end)
	if ground then
		ground.CFrame = World.toWorld(CFrame.new(0, -0.5, math.round(pz / 10) * 10 - 200))
	end
end

function Course.updateMovers(dt: number)
	for _, o in Course.movers do
		o.x += o.vx * dt
		if math.abs(o.x) > 12.5 then
			o.x = sign(o.x) * 12.5
			o.vx = -o.vx
		end
		o.spin -= o.vx * dt / 1.15
		if o.part and o.part.Parent then
			o.part.CFrame = World.toWorld(CFrame.new(o.x, 1.15, o.z) * CFrame.Angles(0, 0, o.spin))
		end
	end
end

-- spin the coins near the rider
local coinParts, coinCFrames = {}, {}
function Course.updateCoins(time: number, pz: number)
	table.clear(coinParts)
	table.clear(coinCFrames)
	local spin = CFrame.Angles(0, time * 3, 0) * coinRot
	local bob = math.sin(time * 4) * 0.08
	for _, c in Course.coins do
		if not c.taken and c.z > pz - 120 then
			table.insert(coinParts, c.part)
			table.insert(coinCFrames, World.toWorld(CFrame.new(c.x, c.y + bob, c.z) * spin))
		end
	end
	workspace:BulkMoveTo(coinParts, coinCFrames, Enum.BulkMoveMode.FireCFrameChanged)
end

function Course.takeCoin(c)
	c.taken = true
	if c.part then
		c.part:Destroy()
		c.part = nil
	end
end

function Course.removeObstacle(o)
	o.dead = true
	if o.model then
		o.model:Destroy()
		o.model = nil
	end
end

-- far scenery follows the camera (it never gets any closer)
function Course.followCamera(camPos: Vector3)
	if mountains then
		mountains:PivotTo(CFrame.new(camPos.X, camPos.Y, camPos.Z))
	end
end

return Course
