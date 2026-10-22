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
bg.BackgroundColor3 = Color3.new(1, 1, 1)
local grad = Instance.new("UIGradient")
grad.Color = ColorSequence.new(hex("4fb3ff"), hex("10243b"))
grad.Rotation = 90
grad.Parent = bg
bg.Parent = gui

local function label(text: string, size: number, y: number, color: Color3)
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.AnchorPoint = Vector2.new(0.5, 0.5)
	l.Position = UDim2.fromScale(0.5, y)
	l.Size = UDim2.new(0.9, 0, 0, size + 10)
	l.Font = Enum.Font.FredokaOne
	l.TextSize = size
	l.TextColor3 = color
	l.Text = text
	local s = Instance.new("UIStroke")
	s.Thickness = math.max(2, size / 18)
	s.Color = hex("10243b")
	s.Parent = l
	l.Parent = bg
	return l
end
local title = label("PEAK FLIP", 96, 0.38, Color3.new(1, 1, 1))
local titleScale = Instance.new("UIScale")
titleScale.Parent = title
label("Flip. Spin. Grab. Don't hug a tree.", 26, 0.5, hex("ffd23f"))
local tip = label("", 20, 0.78, hex("dbeeff"))

local barBack = Instance.new("Frame")
barBack.AnchorPoint = Vector2.new(0.5, 0.5)
barBack.Position = UDim2.fromScale(0.5, 0.64)
barBack.Size = UDim2.fromOffset(420, 26)
barBack.BackgroundColor3 = hex("10243b")
Instance.new("UICorner", barBack).CornerRadius = UDim.new(1, 0)
barBack.Parent = bg
local bar = Instance.new("Frame")
bar.Size = UDim2.fromScale(0, 1)
bar.BackgroundColor3 = hex("3ddc4a")
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
