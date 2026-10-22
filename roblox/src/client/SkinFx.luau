-- Small outfit animations on every character in view (and on the rider copy): a bobbing pompom,
-- a fluttering scarf, a pulsing jetpack. Also flickers the lodge's fires and candles and turns the
-- mannequins. Runs on each client, so it's smooth and costs no network.
local CollectionService = game:GetService("CollectionService")
local RunService = game:GetService("RunService")

local SkinFx = {}

type Anim = { part: BasePart, weld: Weld?, kind: string, base: CFrame, side: number, seed: number, pivot: CFrame?, angle: number, radius: number, rot: CFrame, light: PointLight? }
local anims: { [BasePart]: Anim } = {}

local function track(part: Instance)
	if not part:IsA("BasePart") then
		return
	end
	local base = part:GetAttribute("Base")
	if typeof(base) ~= "CFrame" then
		return
	end
	local a: Anim = {
		part = part,
		weld = part:FindFirstChild("SkinWeld") :: Weld?,
		kind = part:GetAttribute("Anim") or "",
		base = base,
		side = part:GetAttribute("Side") or 1,
		seed = part:GetAttribute("Seed") or 0,
		pivot = nil,
		angle = 0,
		radius = 0,
		rot = CFrame.identity,
		light = part:FindFirstChildOfClass("PointLight"),
	}
	local pivot = part:GetAttribute("Pivot")
	if typeof(pivot) == "CFrame" then
		a.pivot = pivot
		a.angle = math.rad(part:GetAttribute("OrbitAngle") or 0)
		a.radius = part:GetAttribute("OrbitRadius") or 0
		-- whatever rotation the part had on top of its place on the circle
		a.rot = (pivot * CFrame.Angles(0, a.angle, 0) * CFrame.new(a.radius, 0, 0)):Inverse() * base
	end
	anims[part] = a
end

local flickers: { [PointLight]: number } = {}
local function trackLight(l: Instance)
	if l:IsA("PointLight") then
		flickers[l] = l.Brightness
	end
end

for _, p in CollectionService:GetTagged("SkinAnim") do
	track(p)
end
CollectionService:GetInstanceAddedSignal("SkinAnim"):Connect(track)
CollectionService:GetInstanceRemovedSignal("SkinAnim"):Connect(function(p)
	anims[p :: BasePart] = nil
end)
for _, l in CollectionService:GetTagged("Flicker") do
	trackLight(l)
end
CollectionService:GetInstanceAddedSignal("Flicker"):Connect(trackLight)
CollectionService:GetInstanceRemovedSignal("Flicker"):Connect(function(l)
	flickers[l :: PointLight] = nil
end)

local camera = workspace.CurrentCamera
local t = 0
local flickerT = 0

function SkinFx.step(dt: number)
	t += dt
	local camPos = camera.CFrame.Position
	for part, a in anims do
		if not part.Parent then
			anims[part] = nil
			continue
		end
		if (part.Position - camPos).Magnitude > 220 then
			continue
		end
		-- moves go twice as fast while the rider is in the air
		local model = part:FindFirstAncestorOfClass("Model")
		local speed = if model and model:GetAttribute("Air") then 2.2 else 1
		local s = t * speed + a.seed
		local kind = a.kind
		local c0: CFrame? = nil
		if kind == "spin" then
			if a.pivot then
				c0 = a.pivot * CFrame.Angles(0, a.angle + t * 1.8 * speed, 0) * CFrame.new(a.radius, 0, 0) * a.rot
			else
				c0 = a.base * CFrame.Angles(0, t * 2 * speed, 0)
			end
		elseif kind == "flap" then
			c0 = a.base * CFrame.Angles(0, a.side * math.sin(s * 6) * 0.45, 0)
		elseif kind == "flutter" then
			c0 = a.base * CFrame.Angles(math.sin(s * 10) * 0.35, 0, math.cos(s * 8) * 0.2 * a.side)
		elseif kind == "bob" then
			c0 = a.base + Vector3.new(0, math.sin(s * 3) * 0.15, 0)
		elseif kind == "pulse" then
			part.Transparency = 0.1 + 0.4 * (0.5 + 0.5 * math.sin(s * 4))
		elseif kind == "blink" then
			part.Transparency = if math.sin(s * 5) > 0 then 0 else 0.85
		elseif kind == "flicker" and a.light then
			a.light.Brightness = 1.6 + math.random() * 1.2
		end
		if c0 and a.weld then
			a.weld.C0 = c0
		end
	end
	-- fires, candles and lanterns
	flickerT += dt
	if flickerT > 0.08 then
		flickerT = 0
		for l, base in flickers do
			if l.Parent then
				l.Brightness = base * (0.8 + math.random() * 0.4)
			else
				flickers[l] = nil
			end
		end
	end
	-- mannequins on their pedestals
	for _, m in CollectionService:GetTagged("Turntable") do
		if m:IsA("Model") then
			m:PivotTo(m:GetPivot() * CFrame.Angles(0, dt * 0.6, 0))
		end
	end
end

RunService.RenderStepped:Connect(SkinFx.step)

return SkinFx
