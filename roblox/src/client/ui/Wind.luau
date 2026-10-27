-- Wind when you're going fast: thin white streaks rushing out from the middle of the screen,
-- more and brighter the faster you go. Flat and stylised, drawn under the HUD.
local Players = game:GetService("Players")

local Wind = {}

local gui = Instance.new("ScreenGui")
gui.Name = "Wind"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.DisplayOrder = -1
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

type Streak = { frame: Frame, age: number, life: number, angle: number, r0: number, r1: number, len: number, alpha: number }
local pool: { Frame } = {}
local live: { Streak } = {}
local spawnAcc = 0

local function take(): Frame
	local f = table.remove(pool)
	if f then
		f.Visible = true
		return f
	end
	local n = Instance.new("Frame")
	n.AnchorPoint = Vector2.new(0.5, 0.5)
	n.BorderSizePixel = 0
	n.BackgroundColor3 = Color3.new(1, 1, 1)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(1, 0)
	corner.Parent = n
	n.Parent = gui
	return n
end

-- k: 0 (calm) .. 1 (flat out). Call every frame.
function Wind.update(k: number, dt: number)
	local view = gui.AbsoluteSize
	local half = view / 2
	local reach = half.Magnitude
	spawnAcc += dt * 55 * k * k
	while spawnAcc >= 1 and #live < 40 do
		spawnAcc -= 1
		local angle = math.random() * math.pi * 2
		table.insert(live, {
			frame = take(),
			age = 0,
			life = 0.22 + math.random() * 0.18,
			angle = angle,
			r0 = reach * (0.3 + math.random() * 0.25),
			r1 = reach * (0.85 + math.random() * 0.3),
			len = 60 + math.random() * 140 * k,
			alpha = 0.35 + 0.45 * k,
		})
	end
	spawnAcc = math.min(spawnAcc, 1)
	for i = #live, 1, -1 do
		local s = live[i]
		s.age += dt
		local u = s.age / s.life
		if u >= 1 then
			s.frame.Visible = false
			table.insert(pool, s.frame)
			table.remove(live, i)
			continue
		end
		local r = s.r0 + (s.r1 - s.r0) * (u * (2 - u))
		local dir = Vector2.new(math.cos(s.angle), math.sin(s.angle))
		local pos = half + dir * r
		local f = s.frame
		f.Position = UDim2.fromOffset(pos.X, pos.Y)
		f.Size = UDim2.fromOffset(s.len * (0.6 + 0.6 * u), 2 + 1.5 * k)
		f.Rotation = math.deg(s.angle)
		f.BackgroundTransparency = 1 - s.alpha * math.sin(math.pi * u)
	end
end

function Wind.clear()
	for _, s in live do
		s.frame.Visible = false
		table.insert(pool, s.frame)
	end
	table.clear(live)
end

return Wind
