-- Maps simulation space onto the Roblox workspace.
-- Simulation space is the web game's: x across the run, y up from the snow, z negative going downhill,
-- in metres. The whole course is tilted by SLOPE and scaled by S studs per metre.
local Tuning = require(script.Parent.Tuning)

local World = {}

World.S = 2.8 -- studs per metre: a 1.8 m rider is about as tall as a Roblox avatar
World.SLOPE = CFrame.Angles(-Tuning.SLOPE, 0, 0)

local folder = Instance.new("Folder")
folder.Name = "PeakFlipCourse" -- built by this client only; nobody else sees it
folder.Parent = workspace
World.folder = folder

-- The slope keeps dropping, so a long run would end up thousands of studs from the origin, where
-- Roblox gets jittery. Drawing is offset by originZ, which recenter() moves along with the rider.
World.originZ = 0

-- simulation CFrame -> workspace CFrame
function World.toWorld(cf: CFrame): CFrame
	local pos = cf.Position
	return World.SLOPE * (cf.Rotation + Vector3.new(pos.X, pos.Y, pos.Z - World.originZ) * World.S)
end

function World.point(x: number, y: number, z: number): Vector3
	return World.SLOPE * (Vector3.new(x, y, z - World.originZ) * World.S)
end

-- Shift everything that's been drawn so the rider stays near the origin.
-- Returns the workspace offset that was applied (for the camera), or nil if nothing moved.
function World.recenter(pz: number): Vector3?
	if math.abs(pz - World.originZ) < 400 then
		return nil
	end
	local newOrigin = math.round(pz / 100) * 100
	local delta = World.SLOPE:VectorToWorldSpace(Vector3.new(0, 0, -(newOrigin - World.originZ) * World.S))
	World.originZ = newOrigin
	local parts, cframes = {}, {}
	for _, d in folder:GetDescendants() do
		if d:IsA("BasePart") then
			table.insert(parts, d)
			table.insert(cframes, d.CFrame + delta)
		end
	end
	workspace:BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged)
	return delta
end

export type PartOpts = {
	class: string?,
	shape: Enum.PartType?,
	material: Enum.Material?,
	transparency: number?,
	shadow: boolean?,
	reflectance: number?,
}

-- Everything is smooth plastic; only glowing (Neon) and see-through (Glass) parts differ.
local function smooth(m: Enum.Material?): Enum.Material
	if m == Enum.Material.Neon or m == Enum.Material.Glass then
		return m
	end
	return Enum.Material.SmoothPlastic
end

-- An anchored, non-colliding part. `size` and `cf` are in simulation units.
function World.part(parent: Instance, size: Vector3, cf: CFrame, color: Color3, opts: PartOpts?): BasePart
	local o: PartOpts = opts or {}
	local p = Instance.new(o.class or "Part") :: BasePart
	if o.shape then
		(p :: Part).Shape = o.shape
	end
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = if o.shadow == nil then true else o.shadow
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = smooth(o.material)
	p.Color = color
	p.Transparency = o.transparency or 0
	p.Reflectance = o.reflectance or 0
	p.Size = size * World.S
	p.CFrame = World.toWorld(cf)
	p.Parent = parent
	return p
end

function World.model(name: string): Model
	local m = Instance.new("Model")
	m.Name = name
	m.Parent = folder
	return m
end

-- WedgeParts are full height at their back (+Z) and slope down to their front (-Z).
local WEDGE_TALL_AT_FRONT = CFrame.Angles(0, math.pi, 0)

-- A solid strip of snow following a height profile along z, built from blocks with wedges on top.
-- fn(t) returns the height at t in [0, 1], where t = 0 is at z0 and t = 1 is at z0 - L.
function World.profile(parent: Instance, x: number, z0: number, L: number, W: number, fn: (number) -> number, seg: number, color: Color3, material: Enum.Material?)
	local opts = { material = material }
	local wedgeOpts = { material = material, class = "WedgePart" }
	for i = 0, seg - 1 do
		local t0, t1 = i / seg, (i + 1) / seg
		local za, zb = z0 - t0 * L, z0 - t1 * L
		local ha, hb = fn(t0), fn(t1)
		local lo, hi = math.min(ha, hb), math.max(ha, hb)
		local len = za - zb + 0.02
		local mid = (za + zb) / 2
		if lo > 0.02 then
			World.part(parent, Vector3.new(W, lo, len), CFrame.new(x, lo / 2, mid), color, opts)
		end
		if hi - lo > 0.01 then
			-- the tall end is the higher one: downhill (-z) on the way up, uphill (+z) on the way down
			local rot = if hb > ha then WEDGE_TALL_AT_FRONT else CFrame.identity
			World.part(parent, Vector3.new(W, hi - lo, len), CFrame.new(x, lo + (hi - lo) / 2, mid) * rot, color, wedgeOpts)
		end
	end
end

return World
