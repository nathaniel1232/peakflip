-- 3D previews for the shop: real models in ViewportFrames, slowly turning.
-- Skis, snowboards, trails (skis with the trail streaming behind), and outfit pieces worn by the
-- game's rider on a mannequin.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("PeakFlip")
local Catalog = require(Shared:WaitForChild("Catalog"))
local Outfit = require(Shared:WaitForChild("Outfit"))
local Theme = require(Shared:WaitForChild("Theme"))

local hex = Color3.fromHex
local material = Theme.material

local Preview = {}

type Spinner = { viewport: ViewportFrame, model: Model, tilt: CFrame, angle: number, speed: number }
local spinners: { Spinner } = {}

local function block(model: Model, size: Vector3, cf: CFrame, color: Color3, mat: Enum.Material?, shape: Enum.PartType?)
	local p = Instance.new("Part")
	if shape then
		p.Shape = shape
	end
	p.Anchored = true
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Material = if mat == Enum.Material.Neon then mat else Enum.Material.SmoothPlastic
	p.TopSurface, p.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
	p.Parent = model
	return p
end

local function skiPair(model: Model, item, z: number?)
	local oz = z or 0
	for _, sx in { -0.45, 0.45 } do
		block(model, Vector3.new(0.5, 0.14, 5.3), CFrame.new(sx, 0, oz), hex(item.color))
		block(model, Vector3.new(0.5, 0.14, 0.8), CFrame.new(sx, 0.18, oz - 2.85) * CFrame.Angles(0.5, 0, 0), hex(item.tip), material(item.glow))
		block(model, Vector3.new(0.55, 0.35, 1.1), CFrame.new(sx, 0.24, oz + 0.3), hex("222831"))
	end
end

local builders = {}

function builders.skis(item)
	local m = Instance.new("Model")
	skiPair(m, item)
	return m, CFrame.Angles(math.rad(-55), 0, math.rad(12))
end

function builders.boards(item)
	local m = Instance.new("Model")
	local mat = Enum.Material.SmoothPlastic
	block(m, Vector3.new(1.5, 0.18, 4.4), CFrame.new(), hex(item.color), mat)
	for _, sz in { -1, 1 } do
		block(m, Vector3.new(1.5, 0.18, 0.8), CFrame.new(0, 0.16, sz * 2.5) * CFrame.Angles(sz * -0.45, 0, 0), hex(item.color), mat)
		-- bindings
		block(m, Vector3.new(1.1, 0.4, 0.6), CFrame.new(0, 0.29, sz * 0.9), hex(item.binding), material(item.glow))
	end
	-- a stripe down the deck
	block(m, Vector3.new(0.36, 0.02, 4.4), CFrame.new(0, 0.1, 0), hex(item.accent), material(item.glow))
	block(m, Vector3.new(1.52, 0.02, 0.25), CFrame.new(0, 0.1, -1.8), hex(item.accent), material(item.glow))
	return m, CFrame.Angles(math.rad(-60), 0, math.rad(15))
end

function builders.trails(item)
	local m = Instance.new("Model")
	skiPair(m, { color = "1d3557", tip = "e63946" }, -2.5)
	local colors = item.colors
	local n = 12
	for i = 1, n do
		local k = (i - 1) / (n - 1)
		local idx = 1 + k * (#colors - 1)
		local lo, hi = math.floor(idx), math.min(#colors, math.floor(idx) + 1)
		local c = hex(colors[lo]):Lerp(hex(colors[hi]), idx - lo)
		for _, sx in { -0.45, 0.45 } do
			local p = block(m, Vector3.new(0.42, 0.04, 0.6), CFrame.new(sx, -0.05 + math.sin(k * 3) * 0.3, 0.5 + i * 0.58), c, if item.glow then Enum.Material.Neon else Enum.Material.SmoothPlastic)
			p.Transparency = k * 0.75
		end
	end
	return m, CFrame.Angles(math.rad(-25), math.rad(35), 0)
end

-- an outfit piece, worn with the rest of the default outfit
local function outfitBuilder(slot: string)
	return function(item)
		local equipped = table.clone(Catalog.DEFAULT_OUTFIT)
		equipped[slot] = item.id
		local o = Outfit.resolve(equipped)
		local m = Outfit.mannequin()
		Outfit.paint(m, o)
		Outfit.attach(m, o, { static = true })
		-- hats and goggles are easier to see a little closer to the head
		local tilt = if slot == "hats" or slot == "goggles" then CFrame.Angles(math.rad(-8), 0, 0) else CFrame.identity
		return m, tilt
	end
end
for _, slot in Catalog.SLOTS do
	builders[slot] = outfitBuilder(slot)
end

-- Fill `parent` with a turning 3D model of a shop item. kind: skis | boards | trails | skins
function Preview.new(parent: GuiObject, kind: string, item, props)
	local vp = Instance.new("ViewportFrame")
	vp.Name = "Preview"
	vp.BackgroundTransparency = 1
	vp.Size = props.Size or UDim2.fromScale(1, 1)
	vp.Position = props.Position or UDim2.new()
	vp.AnchorPoint = props.AnchorPoint or Vector2.zero
	vp.Ambient = Color3.fromRGB(190, 190, 200)
	vp.LightColor = Color3.fromRGB(255, 250, 240)
	vp.LightDirection = Vector3.new(-1, -2, -1)
	local build = builders[kind]
	if not build then
		vp.Parent = parent
		return vp
	end
	local model, tilt = build(item)
	-- centre the model on the origin so it turns in place
	local cf, size = model:GetBoundingBox()
	for _, p in model:GetDescendants() do
		if p:IsA("BasePart") then
			p.CFrame = cf:Inverse() * p.CFrame
		end
	end
	model.WorldPivot = CFrame.new()
	model.Parent = vp
	local cam = Instance.new("Camera")
	cam.FieldOfView = 30
	local extent = size.Magnitude
	local dist = extent / (2 * math.tan(math.rad(cam.FieldOfView) / 2)) * 0.95
	cam.CFrame = CFrame.lookAt(Vector3.new(0, extent * 0.12, -dist), Vector3.zero)
	cam.Parent = vp
	vp.CurrentCamera = cam
	vp.Parent = parent
	local spinner: Spinner = { viewport = vp, model = model, tilt = tilt, angle = math.random() * 6, speed = props.Speed or 0.8 }
	model:PivotTo(CFrame.Angles(0, spinner.angle, 0) * tilt)
	table.insert(spinners, spinner)
	return vp
end

RunService.RenderStepped:Connect(function(dt)
	for i = #spinners, 1, -1 do
		local s = spinners[i]
		if not s.viewport.Parent then
			table.remove(spinners, i)
		elseif s.viewport.Visible then
			s.angle += dt * s.speed
			s.model:PivotTo(CFrame.Angles(0, s.angle, 0) * s.tilt)
		end
	end
end)

return Preview
