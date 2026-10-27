-- UI building blocks in one flat, simple style: solid colours, rounded corners, no gradients, drop
-- shadows or heavy outlines. Buttons still bounce; windows pop; toasts, bars and coin icons.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Sfx = require(script.Parent.Parent.Sfx)
local Shared = ReplicatedStorage:WaitForChild("PeakFlip")
local Theme = require(Shared:WaitForChild("Theme"))

local hex = Color3.fromHex
local Kit = {}

-- One main colour (blue) for nearly everything; green for play/buy, gold for coins, red for close.
Kit.C = {
	ink = Theme.ink,
	panel = Theme.panel,
	panel2 = Theme.panel2,
	sky = hex("8cc4ff"),
	blue = Theme.primary,
	green = Theme.green,
	gold = Theme.gold,
	red = Theme.red,
	grey = hex("5b6676"),
	white = Color3.new(1, 1, 1),
}
local C = Kit.C
Kit.TITLE = Enum.Font.BuilderSansExtraBold
Kit.BODY = Enum.Font.BuilderSansBold
Kit.BLACK = Enum.Font.BuilderSansExtraBold

function Kit.darken(c: Color3, k: number): Color3
	local h, s, v = c:ToHSV()
	return Color3.fromHSV(h, math.min(1, s * 1.05), v * (1 - k))
end
function Kit.lighten(c: Color3, k: number): Color3
	return c:Lerp(Color3.new(1, 1, 1), k)
end

function Kit.make(class: string, props, children: { Instance }?): any
	local o = Instance.new(class)
	for k, v in props do
		if k ~= "Parent" then
			(o :: any)[k] = v
		end
	end
	for _, c in children or {} do
		c.Parent = o
	end
	if props.Parent then
		o.Parent = props.Parent
	end
	return o
end
local make = Kit.make

function Kit.corner(r: number?)
	return make("UICorner", { CornerRadius = if r then UDim.new(0, r) else UDim.new(0, 12) })
end
function Kit.round()
	return make("UICorner", { CornerRadius = UDim.new(1, 0) })
end
-- Borders only where they mean something (a highlight colour); the default dark outline is gone.
function Kit.stroke(thick: number, color: Color3?, transparency: number?)
	local plain = color == nil or color == C.ink
	return make("UIStroke", {
		Thickness = math.min(thick, 2),
		Color = color or C.ink,
		Transparency = if plain then 1 else transparency or 0,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
	})
end
-- A soft outline, only where text sits on the 3D world (white snow): enough to read, not a heavy border.
function Kit.textStroke(thick: number, color: Color3?)
	return make("UIStroke", { Thickness = math.clamp(thick * 0.5, 1, 2.5), Color = color or C.ink, Transparency = 0.35, ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual })
end
-- Flat: one solid colour (kept so callers don't change; `bottom` is the colour used).
function Kit.gradient(_top: Color3, bottom: Color3)
	return make("UIGradient", { Color = ColorSequence.new(bottom), Rotation = 90 })
end
function Kit.padding(px: number)
	return make("UIPadding", { PaddingTop = UDim.new(0, px), PaddingBottom = UDim.new(0, px), PaddingLeft = UDim.new(0, px), PaddingRight = UDim.new(0, px) })
end
function Kit.list(dir: Enum.FillDirection?, gap: number?, align: Enum.HorizontalAlignment?, valign: Enum.VerticalAlignment?)
	return make("UIListLayout", {
		FillDirection = dir or Enum.FillDirection.Vertical,
		Padding = UDim.new(0, gap or 8),
		SortOrder = Enum.SortOrder.LayoutOrder,
		HorizontalAlignment = align or Enum.HorizontalAlignment.Left,
		VerticalAlignment = valign or Enum.VerticalAlignment.Top,
	})
end
function Kit.maxSize(w: number, h: number?)
	return make("UISizeConstraint", { MaxSize = Vector2.new(w, h or math.huge) })
end

-- ---------- icons ----------
-- Images come from the icon pack once uploaded (see tools/upload_assets.py); the server publishes each
-- icon's image under PeakFlip.IconImages. Until then (or if one is missing) a fallback is shown.
local images: { [string]: string } = {}
local iconViews: { [string]: { { image: ImageLabel, fallback: GuiObject? } } } = {}
local function showImage(name: string)
	for _, v in iconViews[name] or {} do
		v.image.Image = images[name]
		v.image.Visible = true
		if v.fallback then
			v.fallback.Visible = false
		end
	end
end
local function watchIcons(folder: Instance)
	local function add(v: Instance)
		if v:IsA("StringValue") then
			images[v.Name] = v.Value
			showImage(v.Name)
		end
	end
	for _, v in folder:GetChildren() do
		add(v)
	end
	folder.ChildAdded:Connect(add)
end
task.spawn(function()
	watchIcons(Shared:WaitForChild("IconImages", math.huge))
end)

function Kit.hasIcon(name: string): boolean
	return images[name] ~= nil
end

-- An icon from the pack. `fallback` is an emoji string, or a function that builds a GuiObject.
-- props: Size, Position, AnchorPoint, Parent, LayoutOrder, ZIndex, Rotation
function Kit.icon(name: string?, fallback: (string | (() -> GuiObject))?, props)
	local holder = make("Frame", {
		Name = "Icon",
		BackgroundTransparency = 1,
		Size = props.Size or UDim2.fromOffset(40, 40),
		Position = props.Position or UDim2.new(),
		AnchorPoint = props.AnchorPoint or Vector2.zero,
		LayoutOrder = props.LayoutOrder or 0,
		ZIndex = props.ZIndex or 1,
		Rotation = props.Rotation or 0,
	})
	local img = make("ImageLabel", {
		BackgroundTransparency = 1,
		Size = UDim2.fromScale(1, 1),
		ScaleType = Enum.ScaleType.Fit,
		Image = if name then images[name] or "" else "",
		Visible = name ~= nil and images[name] ~= nil,
		ZIndex = props.ZIndex or 1,
		Parent = holder,
	})
	local fb: GuiObject? = nil
	if type(fallback) == "function" then
		fb = fallback()
	elseif type(fallback) == "string" then
		fb = make("TextLabel", { BackgroundTransparency = 1, Text = fallback, TextScaled = true, Font = Enum.Font.GothamBold, TextColor3 = Color3.new(1, 1, 1) })
	end
	if fb then
		fb.Size = UDim2.fromScale(1, 1)
		fb.Position = UDim2.new()
		fb.AnchorPoint = Vector2.zero
		fb.ZIndex = props.ZIndex or 1
		fb.Visible = not img.Visible
		fb.Parent = holder
	end
	if name then
		iconViews[name] = iconViews[name] or {}
		table.insert(iconViews[name], { image = img, fallback = fb })
	end
	holder.Parent = props.Parent
	return holder
end

-- Fade a label out, outline and all. (A UIStroke keeps drawing after the text has faded, which
-- left black ghosts of old trick names on screen.)
function Kit.fade(label: TextLabel, t: number)
	local info = TweenInfo.new(t)
	TweenService:Create(label, info, { TextTransparency = 1 }):Play()
	for _, st in label:GetChildren() do
		if st:IsA("UIStroke") then
			TweenService:Create(st, info, { Transparency = 1 }):Play()
		end
	end
end
function Kit.unfade(label: TextLabel)
	label.TextTransparency = 0
	for _, st in label:GetChildren() do
		if st:IsA("UIStroke") then
			st.Transparency = 0.35
		end
	end
end

-- white text with a dark outline, the house style
function Kit.text(props)
	local base = {
		BackgroundTransparency = 1,
		TextColor3 = C.white,
		Font = Kit.TITLE,
		TextSize = 20,
		Text = "",
	}
	local outline = props.Outline
	props.Outline = nil
	for k, v in props do
		base[k] = v
	end
	local l = make("TextLabel", base)
	if outline ~= nil and outline ~= false then
		Kit.textStroke(outline).Parent = l
	end
	return l
end

-- hover grows, press squashes
function Kit.bouncy(gui: GuiObject, scaleTarget: GuiObject?)
	local scale = make("UIScale", { Parent = scaleTarget or gui })
	local info = TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	local function to(v)
		TweenService:Create(scale, info, { Scale = v }):Play()
	end
	gui.MouseEnter:Connect(function()
		to(1.04)
		Sfx.hover()
	end)
	gui.MouseLeave:Connect(function()
		to(1)
	end)
	gui.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			to(0.94)
		end
	end)
	gui.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			to(1)
		end
	end)
	return scale
end

-- A flat button: one solid colour, rounded. Returns the holder and the clickable face.
-- props: Text, Color, Size, Position, AnchorPoint, TextSize, LayoutOrder, Parent, Icon
function Kit.button(props, onClick: (() -> ())?)
	local color = props.Color or C.green
	local holder = make("Frame", {
		Name = props.Name or "Button",
		BackgroundTransparency = 1,
		Size = props.Size or UDim2.fromOffset(160, 50),
		Position = props.Position or UDim2.new(),
		AnchorPoint = props.AnchorPoint or Vector2.zero,
		LayoutOrder = props.LayoutOrder or 0,
		Visible = if props.Visible == nil then true else props.Visible,
		Parent = props.Parent,
	})
	local face = make("TextButton", {
		Name = "Face",
		AutoButtonColor = false,
		BackgroundColor3 = color,
		Size = UDim2.fromScale(1, 1),
		Text = props.Text or "",
		Font = props.Font or Kit.TITLE,
		TextSize = props.TextSize or 24,
		TextColor3 = C.white,
		TextWrapped = true,
		Parent = holder,
	}, {
		Kit.corner(props.Radius or 12),
	})
	if props.Icon then
		local hasText = (props.Text or "") ~= ""
		local h = props.IconSize or 0.78
		Kit.icon(props.Icon, props.IconFallback, {
			Parent = face,
			Size = UDim2.fromScale(h, h),
			AnchorPoint = Vector2.new(if hasText then 0 else 0.5, 0.5),
			Position = if hasText then UDim2.new(0, 8, 0.5, 0) else UDim2.fromScale(0.5, 0.5),
			ZIndex = 3,
		}).SizeConstraint = Enum.SizeConstraint.RelativeYY
		if hasText then
			make("UIPadding", { PaddingLeft = UDim.new(0.3, 0), Parent = face })
		end
	end
	Kit.bouncy(face, holder)
	if onClick then
		face.Activated:Connect(function()
			Sfx.click()
			onClick()
		end)
	end
	return holder, face
end

-- recolour a Kit.button
function Kit.setButtonColor(holder: Frame, color: Color3)
	local face = holder:FindFirstChild("Face") :: TextButton
	face.BackgroundColor3 = color
end

local function drawnCoin(size: number)
	return make("Frame", {
		BackgroundColor3 = C.gold,
		Size = UDim2.fromOffset(size, size),
	}, {
		Kit.round(),
		make("TextLabel", {
			BackgroundTransparency = 1,
			Size = UDim2.fromScale(1, 1),
			Text = "$",
			Font = Kit.BLACK,
			TextScaled = true,
			TextColor3 = hex("b8860b"),
		}, { make("UIPadding", { PaddingTop = UDim.new(0.18, 0), PaddingBottom = UDim.new(0.18, 0) }) }),
	})
end

function Kit.coin(size: number, parent: Instance?, pos: UDim2?)
	return Kit.icon("coin", function()
		return drawnCoin(size)
	end, { Size = UDim2.fromOffset(size, size), Position = pos, Parent = parent })
end

-- a rounded progress bar; returns an object with :set(fraction, animate)
function Kit.bar(props)
	local back = make("Frame", {
		BackgroundColor3 = Kit.C.ink,
		BackgroundTransparency = 0.35,
		Size = props.Size,
		Position = props.Position or UDim2.new(),
		AnchorPoint = props.AnchorPoint or Vector2.zero,
		LayoutOrder = props.LayoutOrder or 0,
		Parent = props.Parent,
	}, { Kit.round() })
	local color = props.Color or C.green
	local fill = make("Frame", {
		BackgroundColor3 = color,
		Size = UDim2.fromScale(0, 1),
		Parent = back,
	}, { Kit.round() })
	local label = Kit.text({ Parent = back, Size = UDim2.fromScale(1, 1), TextSize = props.TextSize or 14, ZIndex = 3 })
	local obj = { frame = back, fill = fill, label = label }
	function obj.set(_, frac: number, animate: boolean?)
		local goal = UDim2.fromScale(math.clamp(frac, 0, 1), 1)
		if animate then
			TweenService:Create(fill, TweenInfo.new(0.5, Enum.EasingStyle.Quad), { Size = goal }):Play()
		else
			fill.Size = goal
		end
	end
	return obj
end

-- a little red "!" badge for buttons that need attention
function Kit.dot(parent: Instance)
	return make("Frame", {
		Name = "Dot",
		BackgroundColor3 = C.red,
		Size = UDim2.fromOffset(22, 22),
		Position = UDim2.new(1, -14, 0, -8),
		Visible = false,
		ZIndex = 5,
		Parent = parent,
	}, {
		Kit.round(),
		Kit.text({ Text = "!", Size = UDim2.fromScale(1, 1), TextSize = 16, ZIndex = 6 }),
	})
end

-- ---------- windows ----------
local gui: ScreenGui
local backdrop: TextButton
local openWindow = nil
local windows = {}

function Kit.init(screen: ScreenGui)
	gui = screen
	backdrop = make("TextButton", {
		Name = "Backdrop",
		Text = "",
		AutoButtonColor = false,
		BackgroundColor3 = Color3.new(0, 0, 0),
		BackgroundTransparency = 1,
		Size = UDim2.fromScale(1, 1),
		Visible = false,
		ZIndex = 48, -- above the pause screen, so Settings can open from it
		Parent = gui,
	})
	backdrop.Activated:Connect(function()
		Kit.closeAll()
	end)
end

-- A pop-up window with a coloured header and a close button.
function Kit.window(name: string, title: string, color: Color3, size: Vector2, icon: string?, emoji: string?)
	local root = make("Frame", {
		Name = name,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.52),
		Size = UDim2.new(0.94, 0, 0.86, 0),
		BackgroundColor3 = C.panel,
		Visible = false,
		ZIndex = 50,
		Parent = gui,
	}, {
		Kit.maxSize(size.X, size.Y),
		Kit.corner(18),
	})
	local scale = make("UIScale", { Parent = root })
	-- a plain header on the panel itself: icon, title, close
	local header = make("Frame", {
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 0, 62),
		ZIndex = 31,
		Parent = root,
	})
	make("Frame", { BackgroundColor3 = C.white, BackgroundTransparency = 0.92, BorderSizePixel = 0, Size = UDim2.new(1, -32, 0, 2), Position = UDim2.new(0, 16, 1, -1), ZIndex = 31, Parent = header })
	Kit.icon(icon, emoji, { Parent = header, Size = UDim2.fromOffset(40, 40), Position = UDim2.fromOffset(18, 11), ZIndex = 34 })
	Kit.text({ Parent = header, Text = title, TextSize = 30, Size = UDim2.new(1, -200, 1, 0), Position = UDim2.fromOffset(70, 0), TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 33 })
	local closeHolder = Kit.button({ Parent = header, Text = "✕", Font = Kit.BODY, Color = C.panel2, Size = UDim2.fromOffset(42, 42), Position = UDim2.new(1, -14, 0.5, 0), AnchorPoint = Vector2.new(1, 0.5), TextSize = 22, Radius = 21 }, function()
		Kit.closeAll()
	end)
	for _, d in closeHolder:GetDescendants() do
		if d:IsA("GuiObject") then
			d.ZIndex = 34
		end
	end
	local body = make("Frame", {
		Name = "Body",
		BackgroundTransparency = 1,
		Position = UDim2.fromOffset(0, 62),
		Size = UDim2.new(1, 0, 1, -62),
		ZIndex = 31,
		Parent = root,
	}, { Kit.padding(16) })
	local w = { root = root, body = body, scale = scale, onOpen = nil :: (() -> ())? }
	windows[name] = w
	return w
end

function Kit.open(name: string)
	local w = windows[name]
	if not w then
		return
	end
	if openWindow and openWindow ~= w then
		openWindow.root.Visible = false
	end
	openWindow = w
	if w.onOpen then
		w.onOpen()
	end
	backdrop.Visible = true
	TweenService:Create(backdrop, TweenInfo.new(0.2), { BackgroundTransparency = 0.55 }):Play()
	w.root.Visible = true
	w.scale.Scale = 0.85
	TweenService:Create(w.scale, TweenInfo.new(0.22, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
	Sfx.open()
end

function Kit.closeAll()
	if openWindow then
		local w = openWindow
		openWindow = nil
		local t = TweenService:Create(w.scale, TweenInfo.new(0.15, Enum.EasingStyle.Quad, Enum.EasingDirection.In), { Scale = 0.7 })
		t.Completed:Connect(function()
			if openWindow ~= w then
				w.root.Visible = false
			end
		end)
		t:Play()
	end
	TweenService:Create(backdrop, TweenInfo.new(0.15), { BackgroundTransparency = 1 }):Play()
	task.delay(0.15, function()
		if not openWindow then
			backdrop.Visible = false
		end
	end)
end

function Kit.isOpen(name: string?): boolean
	if name then
		return openWindow ~= nil and openWindow == windows[name]
	end
	return openWindow ~= nil
end

-- ---------- toasts ----------
local toastHolder: Frame? = nil
local TOAST_COLORS = { info = C.blue, success = C.green, error = C.red, coins = C.gold, level = C.blue }
function Kit.toast(text: string, kind: string?)
	if not toastHolder then
		toastHolder = make("Frame", {
			Name = "Toasts",
			BackgroundTransparency = 1,
			AnchorPoint = Vector2.new(0.5, 0),
			Position = UDim2.new(0.5, 0, 0, 120),
			Size = UDim2.new(0, 420, 0, 300),
			ZIndex = 60,
			Parent = gui,
		}, { Kit.list(Enum.FillDirection.Vertical, 8, Enum.HorizontalAlignment.Center) })
	end
	local color = TOAST_COLORS[kind or "info"] or C.blue
	local f = make("Frame", {
		BackgroundColor3 = color,
		Size = UDim2.new(1, 0, 0, 44),
		ZIndex = 60,
		Parent = toastHolder,
	}, { Kit.round() })
	local label = Kit.text({ Parent = f, Text = text, Font = Kit.BODY, TextSize = 20, Size = UDim2.fromScale(1, 1), ZIndex = 61, TextColor3 = if kind == "coins" then C.ink else C.white })
	local scale = make("UIScale", { Scale = 0.3, Parent = f })
	TweenService:Create(scale, TweenInfo.new(0.3, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
	task.delay(2.6, function()
		local info = TweenInfo.new(0.35)
		TweenService:Create(f, info, { BackgroundTransparency = 1 }):Play()
		TweenService:Create(label, info, { TextTransparency = 1 }):Play()
		for _, s in f:GetDescendants() do
			if s:IsA("UIStroke") then
				TweenService:Create(s, info, { Transparency = 1 }):Play()
			end
		end
		task.delay(0.4, function()
			f:Destroy()
		end)
	end)
end

-- count a TextLabel up to a number
function Kit.countUp(label: TextLabel, to: number, duration: number, format: (number) -> string)
	local from = 0
	local t0 = os.clock()
	task.spawn(function()
		while true do
			local k = math.min(1, (os.clock() - t0) / duration)
			local eased = 1 - (1 - k) ^ 3
			label.Text = format(math.floor(from + (to - from) * eased))
			if k >= 1 then
				break
			end
			task.wait()
		end
	end)
end

return Kit
