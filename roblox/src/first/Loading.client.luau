-- A Peak Flip loading screen in place of Roblox's default one. Runs from ReplicatedFirst, so it
-- shows before anything else has loaded; it fades out once the game's own UI is ready.
local Players = game:GetService("Players")
local ReplicatedFirst = game:GetService("ReplicatedFirst")
local TweenService = game:GetService("TweenService")

ReplicatedFirst:RemoveDefaultLoadingScreen()

local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")
local hex = Color3.fromHex

local gui = Instance.new("ScreenGui")
gui.Name = "PeakFlipLoading"
gui.IgnoreGuiInset = true
gui.DisplayOrder = 100
gui.ResetOnSpawn = false

local bg = Instance.new("Frame")
bg.Size = UDim2.fromScale(1, 1)
bg.BorderSizePixel = 0
bg.BackgroundColor3 = hex("2f8cff")
bg.Parent = gui
-- a flat low-poly mountain along the bottom
for i, peak in { { 0.2, 0.2 }, { 0.5, 0.26 }, { 0.8, 0.22 } } do
	local m = Instance.new("Frame")
	m.AnchorPoint = Vector2.new(0.5, 0.5)
	m.Position = UDim2.fromScale(peak[1], 1)
	m.Size = UDim2.fromScale(peak[2], peak[2])
	m.SizeConstraint = Enum.SizeConstraint.RelativeXX
	m.Rotation = 45
	m.BorderSizePixel = 0
	m.BackgroundColor3 = if i == 2 then hex("e8f1fb") else hex("cfe0f3")
	m.ZIndex = if i == 2 then 2 else 1
	m.Parent = bg
end

local function label(text: string, size: number, y: number, color: Color3)
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.AnchorPoint = Vector2.new(0.5, 0.5)
	l.Position = UDim2.fromScale(0.5, y)
	l.Size = UDim2.new(0.9, 0, 0, size + 10)
	l.Font = Enum.Font.BuilderSansExtraBold
	l.TextSize = size
	l.TextColor3 = color
	l.Text = text
	l.ZIndex = 3
	l.Parent = bg
	return l
end
local title = label("PEAK FLIP", 96, 0.38, Color3.new(1, 1, 1))
local titleScale = Instance.new("UIScale")
titleScale.Parent = title
label("Flip. Spin. Grab. Don't hug a tree.", 26, 0.5, hex("ffd23f"))
local tip = label("", 20, 0.92, hex("10243b"))

local barBack = Instance.new("Frame")
barBack.AnchorPoint = Vector2.new(0.5, 0.5)
barBack.Position = UDim2.fromScale(0.5, 0.64)
barBack.Size = UDim2.fromOffset(360, 12)
barBack.BackgroundColor3 = hex("1c5fc0")
barBack.ZIndex = 3
Instance.new("UICorner", barBack).CornerRadius = UDim.new(1, 0)
barBack.Parent = bg
local bar = Instance.new("Frame")
bar.Size = UDim2.fromScale(0, 1)
bar.BackgroundColor3 = Color3.new(1, 1, 1)
bar.ZIndex = 3
Instance.new("UICorner", bar).CornerRadius = UDim.new(1, 0)
bar.Parent = barBack

gui.Parent = playerGui

local TIPS = {
	"Tip: land flat for a PERFECT and 1.5x points",
	"Tip: chain tricks within 3 seconds to build a combo up to x8",
	"Tip: trampolines in a row bounce you higher every time",
	"Tip: hold a grab longer for more points",
	"Tip: claim your daily gift at the chest in the lobby",
	"Tip: try the code PEAKFLIP",
}
tip.Text = TIPS[math.random(1, #TIPS)]

task.spawn(function()
	while gui.Parent do
		TweenService:Create(titleScale, TweenInfo.new(0.8, Enum.EasingStyle.Sine), { Scale = 1.06 }):Play()
		task.wait(0.8)
		TweenService:Create(titleScale, TweenInfo.new(0.8, Enum.EasingStyle.Sine), { Scale = 1 }):Play()
		task.wait(0.8)
	end
end)

-- creep the bar along while the game loads, then fill it once the main UI exists
local progress = 0
local t0 = os.clock()
while not (game:IsLoaded() and playerGui:FindFirstChild("PeakFlipUI")) and os.clock() - t0 < 30 do
	progress += (0.9 - progress) * 0.04
	bar.Size = UDim2.fromScale(progress, 1)
	task.wait(1 / 30)
end
TweenService:Create(bar, TweenInfo.new(0.3), { Size = UDim2.fromScale(1, 1) }):Play()
task.wait(0.5)
local fade = TweenInfo.new(0.6)
for _, d in gui:GetDescendants() do
	if d:IsA("TextLabel") then
		TweenService:Create(d, fade, { TextTransparency = 1 }):Play()
	elseif d:IsA("UIStroke") then
		TweenService:Create(d, fade, { Transparency = 1 }):Play()
	elseif d:IsA("Frame") then
		TweenService:Create(d, fade, { BackgroundTransparency = 1 }):Play()
	end
end
task.wait(0.65)
gui:Destroy()
