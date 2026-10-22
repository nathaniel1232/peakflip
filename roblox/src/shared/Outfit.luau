-- Dresses a character-shaped model in an outfit (see Catalog.outfit): body colours plus parts on the
-- limbs (hat, goggles, extras, and the gloves and boots everyone wears). Used on real avatars (welded,
-- animated), on the rider copy (inherits that) and on shop mannequins (static, for 3D previews).
local CollectionService = game:GetService("CollectionService")

local Catalog = require(script.Parent.Catalog)
local Theme = require(script.Parent.Theme)

local Outfit = {}

local hex = Color3.fromHex

-- R15 proportions the part offsets in Catalog are written for
local REF = {
	Head = Vector3.new(1.2, 1.2, 1.2),
	UpperTorso = Vector3.new(2, 1.6, 1),
	LowerTorso = Vector3.new(2, 0.4, 1),
	LeftHand = Vector3.new(1, 0.3, 1),
	RightHand = Vector3.new(1, 0.3, 1),
	LeftFoot = Vector3.new(1, 0.3, 1),
	RightFoot = Vector3.new(1, 0.3, 1),
}
-- R6 avatars have fewer, bigger limbs: { part name, offset from its centre }
local R6 = {
	Head = { "Head", Vector3.zero },
	UpperTorso = { "Torso", Vector3.new(0, 0.2, 0) },
	LowerTorso = { "Torso", Vector3.new(0, -0.8, 0) },
	LeftHand = { "Left Arm", Vector3.new(0, -0.85, 0) },
	RightHand = { "Right Arm", Vector3.new(0, -0.85, 0) },
	LeftFoot = { "Left Leg", Vector3.new(0, -0.85, 0) },
	RightFoot = { "Right Leg", Vector3.new(0, -0.85, 0) },
}
-- body colour slot per limb: 1 head, 2 torso (jacket), 3 arms (jacket), 4 legs (pants)
local SLOT = {
	Head = 1,
	UpperTorso = 2, LowerTorso = 2, Torso = 2,
	LeftUpperArm = 3, LeftLowerArm = 3, LeftHand = 3, RightUpperArm = 3, RightLowerArm = 3, RightHand = 3, ["Left Arm"] = 3, ["Right Arm"] = 3,
	LeftUpperLeg = 4, LeftLowerLeg = 4, LeftFoot = 4, RightUpperLeg = 4, RightLowerLeg = 4, RightFoot = 4, ["Left Leg"] = 4, ["Right Leg"] = 4,
}

-- the Catalog items for an `equipped` table (missing slots fall back to the default outfit)
function Outfit.resolve(equipped)
	local out = {}
	for _, slot in Catalog.SLOTS do
		local id = (equipped and equipped[slot]) or Catalog.DEFAULT_OUTFIT[slot]
		out[slot] = Catalog.find(Catalog.outfit[slot], id) or Catalog.find(Catalog.outfit[slot], Catalog.DEFAULT_OUTFIT[slot])
	end
	return out
end

-- head, torso, arms, legs
function Outfit.colors(o): { Color3 }
	local skin = hex(Catalog.SKIN_TONE)
	return { skin, hex(o.jackets.color), hex(o.jackets.color), hex(o.pants.color) }
end

-- Recolour the body itself, smooth plastic all over.
function Outfit.paint(model: Instance, o)
	local colors = Outfit.colors(o)
	for _, p in model:GetChildren() do
		local slot = SLOT[p.Name]
		if slot and p:IsA("BasePart") then
			p.Color = colors[slot]
			p.Material = Enum.Material.SmoothPlastic
		end
	end
end

local function resolveLimb(model: Instance, limb: string): (BasePart?, CFrame, Vector3)
	local p = model:FindFirstChild(limb)
	if p and p:IsA("BasePart") then
		local ref = REF[limb]
		local scale = if ref then Vector3.new(p.Size.X / ref.X, p.Size.Y / ref.Y, p.Size.Z / ref.Z) else Vector3.one
		return p, CFrame.identity, scale
	end
	local alt = R6[limb]
	if alt then
		local q = model:FindFirstChild(alt[1])
		if q and q:IsA("BasePart") then
			return q, CFrame.new(alt[2]), Vector3.one
		end
	end
	return nil, CFrame.identity, Vector3.one
end

local function v3(t, default: Vector3?): Vector3
	return if t then Vector3.new(t[1], t[2], t[3]) else (default or Vector3.zero)
end

-- Put the outfit's parts on. opts.static: no welds, just place them (ViewportFrames don't run physics).
function Outfit.attach(model: Instance, o, opts)
	Outfit.clear(model)
	local static = opts and opts.static
	local folder = Instance.new("Folder")
	folder.Name = "OutfitParts"
	local specs = table.clone(Catalog.BASE_PARTS)
	for _, slot in Catalog.SLOTS do
		for _, spec in o[slot].parts or {} do
			table.insert(specs, spec)
		end
	end
	for i, spec in specs do
		local limb, extra, scale = resolveLimb(model, spec.limb)
		if not limb then
			continue
		end
		local p = Instance.new("Part")
		if spec.shape == "Ball" then
			p.Shape = Enum.PartType.Ball
		end
		p.Name = "Outfit" .. i
		p.Size = v3(spec.size, Vector3.one) * scale
		p.Color = hex(spec.color or "ffffff")
		p.Material = Theme.material(spec.neon)
		p.TopSurface, p.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
		p.CanCollide, p.CanQuery, p.CanTouch = false, false, false
		p.Massless = true
		local offset = extra * CFrame.new(v3(spec.at) * scale)
		p.CFrame = limb.CFrame * offset
		if static then
			p.Anchored = true
		else
			p.Anchored = false
			local w = Instance.new("Weld")
			w.Name = "SkinWeld"
			w.Part0, w.Part1, w.C0 = limb, p, offset
			w.Parent = p
			if spec.anim then
				p:SetAttribute("Anim", spec.anim)
				p:SetAttribute("Side", 1)
				p:SetAttribute("Base", offset)
				p:SetAttribute("Seed", i)
				CollectionService:AddTag(p, "SkinAnim")
			end
		end
		p.Parent = folder
	end
	folder.Parent = model
end

function Outfit.clear(model: Instance)
	local f = model:FindFirstChild("OutfitParts")
	if f then
		f:Destroy()
	end
end

-- A blocky R15-shaped mannequin for previews and the lodge (named parts in a standing pose).
function Outfit.mannequin(): Model
	local m = Instance.new("Model")
	m.Name = "Mannequin"
	local function limb(name: string, size: Vector3, pos: Vector3)
		local p = Instance.new("Part")
		p.Name = name
		p.Size = size
		p.CFrame = CFrame.new(pos)
		p.Anchored = true
		p.Material = Enum.Material.SmoothPlastic
		p.TopSurface, p.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
		p.Parent = m
		return p
	end
	limb("Head", Vector3.new(1.2, 1.2, 1.2), Vector3.new(0, 4.6, 0))
	limb("UpperTorso", Vector3.new(2, 1.6, 1), Vector3.new(0, 3.2, 0))
	limb("LowerTorso", Vector3.new(2, 0.4, 1), Vector3.new(0, 2.2, 0))
	for _, s in { -1, 1 } do
		local side = if s < 0 then "Left" else "Right"
		limb(side .. "UpperArm", Vector3.new(1, 1.2, 1), Vector3.new(s * 1.5, 3.4, 0))
		limb(side .. "LowerArm", Vector3.new(1, 1.1, 1), Vector3.new(s * 1.5, 2.25, 0))
		limb(side .. "Hand", Vector3.new(1, 0.3, 1), Vector3.new(s * 1.5, 1.55, 0))
		limb(side .. "UpperLeg", Vector3.new(1, 1.2, 1), Vector3.new(s * 0.5, 1.4, 0))
		limb(side .. "LowerLeg", Vector3.new(1, 1.2, 1), Vector3.new(s * 0.5, 0.45, 0))
		limb(side .. "Foot", Vector3.new(1, 0.3, 1), Vector3.new(s * 0.5, -0.3, 0))
	end
	-- a simple face
	for _, s in { -1, 1 } do
		local eye = limb("Eye", Vector3.new(0.14, 0.22, 0.05), Vector3.new(s * 0.22, 4.68, -0.61))
		eye.Color = hex("1b1b22")
	end
	local mouth = limb("Mouth", Vector3.new(0.4, 0.07, 0.05), Vector3.new(0, 4.36, -0.61))
	mouth.Color = hex("1b1b22")
	m.PrimaryPart = m:FindFirstChild("UpperTorso") :: BasePart
	return m
end

-- The uniform base look for real avatars: the default blocky body, no clothes or accessories,
-- same proportions for everyone, coloured by the outfit.
function Outfit.description(o): HumanoidDescription
	local d = Instance.new("HumanoidDescription")
	local c = Outfit.colors(o)
	d.HeadColor = c[1]
	d.TorsoColor = c[2]
	d.LeftArmColor, d.RightArmColor = c[3], c[3]
	d.LeftLegColor, d.RightLegColor = c[4], c[4]
	d.BodyTypeScale, d.ProportionScale = 0, 0
	d.HeightScale, d.WidthScale, d.DepthScale, d.HeadScale = 1, 1, 1, 1
	return d
end

return Outfit
