-- Peak Flip for Roblox: players hang out in a shared lobby with their own avatars; a run is drawn
-- and simulated on the player's client (like the web game) and reported to the server, which keeps
-- saves, the shop, quests and leaderboards.
local GuiService = game:GetService("GuiService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ProximityPromptService = game:GetService("ProximityPromptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")
local UserInputService = game:GetService("UserInputService")

local Course = require(script.Parent.Course)
local Rider = require(script.Parent.Rider)
local Sfx = require(script.Parent.Sfx)
local Tuning = require(script.Parent.Tuning)
local Util = require(script.Parent.Util)
local World = require(script.Parent.World)
local Kit = require(script.Parent.ui.Kit)
local Hud = require(script.Parent.ui.Hud)
local Menus = require(script.Parent.ui.Menus)
local Wind = require(script.Parent.ui.Wind)
require(script.Parent.SkinFx)

local Shared = ReplicatedStorage:WaitForChild("PeakFlip")
local Catalog = require(Shared:WaitForChild("Catalog"))
local Config = require(Shared:WaitForChild("Config"))
local Remotes = Shared:WaitForChild("Remotes")
local player = Players.LocalPlayer

local G, TAU = Tuning.G, Util.TAU
local FLIP_RATE, SPIN_RATE, ROLL_RATE = Tuning.FLIP_RATE, Tuning.SPIN_RATE, Tuning.ROLL_RATE
local X_LIMIT, COMBO_WINDOW, MAX_CHARGE = Tuning.X_LIMIT, Tuning.COMBO_WINDOW, Tuning.MAX_CHARGE
local clamp, damp, rand, wrap, sign, commas = Util.clamp, Util.damp, Util.rand, Util.wrap, Util.sign, Util.commas
local K = Enum.KeyCode

local camera = workspace.CurrentCamera
local isTouch = UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled

pcall(function()
	StarterGui:SetCore("ResetButtonCallback", false)
end)

local state = "lobby" -- lobby | starting | countdown | play | crash | revive | over
local paused = false
local time = 0
local shake = 0
local profile: any = {
	coins = 0,
	best = 0,
	runs = 0,
	upgrades = { magnet = 0, spin = 0, value = 0, start = 0 },
	settings = { music = true, sfx = true, view = "chase", hints = true, lowGfx = false },
	passes = {},
}
-- upgrade effects for the current run
local magnet, trickMul = Catalog.magnetRadius(0), 1
-- riding a snowboard this run (the web game's board physics)
local board = false

-- ---------- player state ----------
local p: { [string]: any } = {}
local function resetPlayer()
	table.clear(p)
	for k, v in
		{
			x = 0, y = 0, z = 0, vx = 0, vy = 0, speed = 20, heading = 0, distScore = 0,
			charging = false, chargeT = 0,
			grounded = true, groundTime = 0, airTime = 0, maxH = 0, fromRamp = false,
			pitch = 0, yaw = 0, roll = 0, pitchVel = 0, yawVel = 0, rollVel = 0, tilt = 0, slideYaw = 0, lean = 0, crouch = 0.2, arch = 0,
			grabbing = false, grindTime = 0,
			trickScore = 0, combo = 0, comboTimer = 0, comboTotal = 0, coins = 0,
			crashed = false, crashT = 0, spinX = 0, spinZ = 0, reason = "",
			boostT = 0, bounceN = 0, bonkT = -1, revives = 0, butterT = 0, butter = false,
		}
	do
		p[k] = v
	end
	p.trick = nil
	p.grinding = nil
	p.lastRail = nil
	p.arms = { 0.35, -0.18, 0.35, 0.18 }
	p.stats = { flips = 0, perfects = 0, grinds = 0, bounces = 0 }
end
resetPlayer()

local function totalScore(): number
	return math.floor(p.distScore) + p.trickScore
end

-- ---------- input ----------
local keys: { [Enum.KeyCode]: boolean } = {}
local keyTime: { [Enum.KeyCode]: number } = {}
-- Keys already held when the rider took off / landed are ignored until released, so holding
-- "steer right" into a jump doesn't turn into an accidental spin.
local latched: { [Enum.KeyCode]: boolean } = {}
local stick = Vector2.zero
local stickHTime, stickLatchH, stickLatchV = 0, false, false

local STEER_KEYS = { K.Left, K.Right, K.A, K.D }
local FLIP_KEYS = { K.Up, K.Down, K.W, K.S }
local GRAB_KEYS = { K.Space, K.J, K.LeftShift, K.RightShift, K.K, K.G, K.ButtonA, K.ButtonX, K.ButtonR2, K.ButtonL2 }
local JUMP_KEYS = { [K.Space] = true, [K.J] = true, [K.ButtonA] = true }

local jumpQueued = false
local ptr = { down = false, x = 0, y = 0, sx = 0, sy = 0, ax = 0, ay = 0, t0 = 0, moved = 0 }

local function latch(list)
	for _, k in list do
		if keys[k] then
			latched[k] = true
		end
	end
end
local function latchAtTakeoff()
	-- W/S held from the ground start a flip at once; A/D only spin if pressed right before the jump
	local now = os.clock()
	for _, k in STEER_KEYS do
		if keys[k] and now - (keyTime[k] or 0) > 0.35 then
			latched[k] = true
		end
	end
	latch(GRAB_KEYS)
	if math.abs(stick.X) > 0.35 and now - stickHTime > 0.35 then
		stickLatchH = true
	end
end
local function latchAtLanding()
	latch(FLIP_KEYS)
	latch(GRAB_KEYS)
	if math.abs(stick.Y) > 0.35 then
		stickLatchV = true
	end
end
local function reanchor()
	ptr.ax, ptr.ay = ptr.x, ptr.y
end

local function held(list): boolean
	for _, k in list do
		if keys[k] and not latched[k] then
			return true
		end
	end
	return false
end

local function readInput()
	local L, R = held({ K.Left, K.A }), held({ K.Right, K.D })
	local U, D = held({ K.Up, K.W }), held({ K.Down, K.S })
	local h = (if R then 1 else 0) - (if L then 1 else 0)
	local v = (if U then 1 else 0) - (if D then 1 else 0)
	local grab = held(GRAB_KEYS)
	if not stickLatchH and math.abs(stick.X) > 0.2 then
		h = clamp(h + stick.X, -1, 1)
	end
	if not stickLatchV and math.abs(stick.Y) > 0.2 then
		v = clamp(v + stick.Y, -1, 1)
	end
	if ptr.down then
		local vp = camera.ViewportSize
		local unit = math.min(vp.X, vp.Y) * 0.16
		local dx, dy = (ptr.x - ptr.ax) / unit, (ptr.y - ptr.ay) / unit
		h = clamp(h + dx, -1, 1)
		v = clamp(v - dy, -1, 1)
		if math.sqrt(dx * dx + dy * dy) < 0.3 and os.clock() - ptr.t0 > 0.2 then
			grab = true
		end
	end
	local jump = jumpQueued
	jumpQueued = false
	return { h = h, v = v, grab = grab, jump = jump }
end

-- ---------- tricks & scoring ----------
local SKI_GRABS = { "Mute", "Safety", "Japan", "Tail", "Indy" }
local BOARD_GRABS = { "Indy", "Melon", "Method", "Stalefish", "Nose" }
local function grabList()
	return if board then BOARD_GRABS else SKI_GRABS
end
-- arm angles per grab: { left x, left z, right x, right z, body arch }; positive x swings an arm forward
local GRAB_POSE = {
	Mute = { 1.3, -0.3, 1.3, 0.3, 0 },
	Safety = { 0.35, -0.6, -0.1, 1.0, 0 },
	Japan = { 1.4, -0.2, -1.2, 0.4, 0.15 },
	Tail = { 0.6, -1.2, -1.4, 0.3, -0.25 },
	Indy = { -0.3, -1.3, 1.1, 0.5, 0 },
	Melon = { 1.2, -0.2, 0.3, 1.4, 0 },
	Method = { -1.2, -0.3, 0.2, 1.5, 0.4 },
	Stalefish = { 0.1, -1.5, -1.3, 0.4, 0 },
	Nose = { 1.6, 0, 0.4, 1.2, -0.2 },
}

local function showTrick(name: string, pts: string?, perfect: boolean?)
	Hud.trick(name, pts or "", perfect)
end

-- G in the air: switch to the next grab; grabs you hold long enough all count toward the trick name
local function nextGrab()
	local t = p.trick
	if not t or p.grounded or p.grinding then
		return
	end
	if t.grab > 0.25 and not table.find(t.grabs, t.grabName) then
		table.insert(t.grabs, t.grabName)
	end
	local list = grabList()
	t.grabName = list[(table.find(list, t.grabName) or 0) % #list + 1]
	t.grab = 0
end

local function startAir()
	p.fromRamp = p.y > 0.3 or p.grinding ~= nil -- hops from flat snow can never crash
	p.grounded = false
	p.airTime = 0
	p.maxH = 0
	latchAtTakeoff()
	if p.charging then
		p.charging = false
		p.vy += Tuning.popFromCharge(p.chargeT) * 0.8
		Sfx.ollie()
	end
	p.trick = { pitch = 0, yaw = 0, roll = 0, grab = 0, switch = math.abs(wrap(p.yaw)) > math.pi / 2, grabName = grabList()[math.random(1, 5)], grabs = {}, grabTotal = 0, tramp = false }
	ptr.ax = ptr.x -- keep the vertical anchor: a held up/down drag starts a flip right away
end

local function award(name: string, pts: number, perfect: boolean?)
	if p.comboTimer > 0 then
		p.combo += 1
	else
		p.combo = 1
		p.comboTotal = 0
	end
	p.comboTimer = COMBO_WINDOW
	local mult = math.min(1 + 0.5 * (p.combo - 1), 8)
	local total = math.round(pts * mult)
	p.trickScore += total
	p.comboTotal += total
	showTrick(name, "+" .. commas(total) .. (if mult > 1 then "  x" .. mult else ""), perfect)
end

-- Landing tiers: perfect -> clean -> sketchy (stumble, lose speed) -> crash. Small hops never crash.
local function landingCheck()
	local np, ny = math.abs(wrap(p.pitch)), wrap(p.yaw)
	local yawErr = math.min(math.abs(ny), math.pi - math.abs(ny))
	local err = math.max(np, yawErr * 0.85, math.abs(wrap(p.roll)))
	local smallHop = not p.fromRamp or (p.maxH < 1.8 and p.airTime < 0.75)
	local ok = err < Tuning.LAND_OK or smallHop
	return { ok = ok, perfect = err < Tuning.LAND_PERFECT, sketchy = ok and err >= Tuning.LAND_SKETCHY, ny = ny }
end

-- When the player lets go of a rotation, finish it to the nearest landable angle.
local function settle(angle: number, vel: number, step: number, rate: number, dt: number): number
	local tgt = math.round(angle / step) * step
	local err = tgt - angle
	if math.abs(err) < 1.0 then
		return damp(vel, err * 8, 14, dt)
	end
	local dir = sign(vel)
	if dir == 0 then
		dir = sign(err)
	end
	return damp(vel, dir * rate * 0.7, 8, dt)
end

local MULTI = { "", "", "Double ", "Triple ", "Quad ", "Quint " }
local function scoreAirTrick(perfect: boolean, sketchy: boolean?)
	local t = p.trick
	if not t then
		return
	end
	local flips = math.round(math.abs(t.pitch) / TAU)
	local rolls = math.round(math.abs(t.roll) / TAU)
	local spins = math.round(math.abs(t.yaw) / math.pi) * 180
	if t.grab > 0.25 and not table.find(t.grabs, t.grabName) then
		table.insert(t.grabs, t.grabName)
	end
	local grabbed = #t.grabs > 0
	-- every extra grab chained in the same air adds a bonus
	local pts = flips * 1000 + rolls * 1100 + (spins / 180) * 300 + (if grabbed then math.round(t.grabTotal * 10) * 70 + (#t.grabs - 1) * 400 else 0)
	if p.airTime > 1.4 then
		pts += math.round(p.airTime * 120)
	end
	if pts == 0 then
		return
	end
	if not sketchy then
		p.stats.flips += flips + rolls
		if perfect then
			p.stats.perfects += 1
		end
	end
	local parts = {}
	if t.switch then
		table.insert(parts, "Switch")
	end
	if spins > 0 then
		local side = if board then (if t.yaw < 0 then "Frontside " else "Backside ") else ""
		table.insert(parts, side .. (if rolls > 0 then "Cork " else "") .. spins)
	end
	if rolls > 0 and spins == 0 then
		table.insert(parts, (MULTI[rolls + 1] or (rolls .. "x ")) .. "Sideflip")
	end
	if flips > 0 then
		table.insert(parts, (MULTI[flips + 1] or (flips .. "x ")) .. (if t.pitch < 0 then "Frontflip" else "Backflip"))
	end
	if grabbed then
		table.insert(parts, table.concat(t.grabs, " to "))
	end
	if #parts == 0 then
		table.insert(parts, "Big Air")
	end
	if sketchy then
		pts = math.round(pts * 0.4)
		table.insert(parts, 1, "Sketchy")
		p.comboTimer = 0
		Sfx.trick(0)
	elseif perfect then
		pts = math.round(pts * 1.5)
		table.insert(parts, 1, "Perfect")
		p.speed += 4
		Sfx.perfect()
		Rider.celebrate("vpose")
	end
	if t.switch and board then
		pts = math.round(pts * 1.25) -- tricks out of switch are harder on a board
	end
	if t.tramp then
		pts = math.round(pts * 1.5)
		table.insert(parts, 1, "Tramp")
	elseif not perfect then
		Sfx.trick(flips + spins / 360)
	end
	award(table.concat(parts, " "), pts, perfect)
end

local crash -- forward declaration

local function bounce()
	-- each bounce in a row goes higher and pays more; tricks off a trampoline score x1.5
	local n = p.bounceN
	-- launch at exactly the speed the line was spaced for, straight down it, so the next trampoline is under you
	p.vy = Tuning.bounceVy(n)
	p.speed = Tuning.baseSpeed(-p.z) * 1.08
	p.heading = 0
	p.vx = 0
	startAir()
	p.fromRamp = true
	p.trick.tramp = true
	p.bounceN = n + 1
	p.stats.bounces += 1
	award(({ "Bounce", "Double Bounce", "Triple Bounce", "Mega Bounce" })[math.min(n, 3) + 1], 150 * (n + 1), n >= 2)
	Sfx.ollie()
	shake = 0.25
	Rider.emit(p.x, 0.5, p.z, 18, Color3.fromHex("ff2d78"), true)
end

local function land(groundSlope: number)
	local lc = landingCheck()
	if not lc.ok then
		return crash("Landed upside down")
	end
	p.y = math.max(p.y, 0)
	p.grounded = true
	p.groundTime = 0
	p.grabbing = false
	p.pitch, p.pitchVel, p.yawVel, p.roll, p.rollVel = 0, 0, 0, 0, 0
	p.yaw = if math.abs(lc.ny) > math.pi / 2 then sign(lc.ny) * math.pi else 0
	p.vy = groundSlope * p.speed
	if not Course.padAt(p.x, p.z, "bounce") then
		p.bounceN = 0 -- a bounce chain ends when you land on snow
	end
	if lc.sketchy then
		p.speed *= 0.8
		p.lean = rand(-0.5, 0.5)
		shake = 0.3
		if not p.trick or (math.abs(p.trick.pitch) < 2 and math.abs(p.trick.yaw) < 2) then
			showTrick("Wobble!", "", false)
		end
	end
	scoreAirTrick(lc.perfect, lc.sketchy)
	p.trick = nil
	latchAtLanding()
	local hard = p.airTime > 1.2
	Sfx.land(hard)
	Rider.emit(p.x, p.y + 0.1, p.z, if hard then 30 else 16, Color3.new(1, 1, 1))
	shake = if hard then 0.35 else 0.15
	p.crouch = 1
	reanchor()
end

local function startGrind(r)
	p.grinding = r
	p.grindTime = 0
	p.grounded = false
	p.vy = 0
	p.y = r.top
	p.lastRail = r
	p.pitch, p.pitchVel, p.yawVel, p.roll, p.rollVel = 0, 0, 0, 0, 0
	p.yaw = if math.abs(wrap(p.yaw)) > math.pi / 2 then math.pi else 0
	Sfx.land(false)
end

local function leaveRail(pop: number)
	local r = p.grinding
	p.grinding = nil
	if p.grindTime > 0.2 then
		p.stats.grinds += 1
		local name = if board then (if p.grindTime > 0.9 then "Long Boardslide" else "Boardslide") else (if r.L > 17 then "Long Rail Slide" else "Rail Slide")
		award(name, (if board then 180 else 150) + math.round(p.grindTime * 600), false)
	end
	p.vy = pop
	startAir()
	if pop > 5 then
		Sfx.ollie()
	end
end

function crash(reason: string)
	if p.crashed then
		return
	end
	p.crashed = true
	p.crashT = 0
	p.reason = reason
	p.grinding = nil
	p.spinX, p.spinZ = rand(-14, 14), rand(-10, 10)
	if p.grounded then
		p.vy = 8
	end
	p.grounded = false
	state = "crash"
	Hud.onCrash()
	Sfx.crash()
	shake = 1.2
	Rider.emit(p.x, p.y + 0.5, p.z, 60, Color3.new(1, 1, 1))
	Rider.shatter(Vector3.new(p.vx, p.vy, -p.speed * math.cos(p.heading)))
end

-- ---------- per-frame player update ----------
local CRASH_REASONS = { tree = "Hugged a tree", rock = "Hit a rock", ball = "Flattened by a snowball" }
local SNOW_WHITE = Color3.new(1, 1, 1)

local function updatePlayer(dt: number)
	local inp = readInput()
	local gh0, gs0 = Course.groundAt(p.x, p.z)
	p.distScore += p.speed * dt * math.max(1, p.speed / 25) -- going faster scores faster

	-- speed: gravity pulls you downhill, drag caps it (the cap rises with distance)
	if p.grounded then
		local vt = Tuning.baseSpeed(-p.z) * 1.1 -- you're always tucked
		local acc = 12 * (1 - (p.speed / vt) ^ 2) -- downhill pull vs drag
		acc -= 0.35 * G * gs0 / math.sqrt(1 + gs0 * gs0) -- climbing a kicker costs a bit of speed
		acc -= (if board then 4.5 else 7) * math.abs(math.sin(p.heading)) -- carving scrubs speed (a board holds its edge better)
		p.speed = math.max(8, p.speed + acc * dt)
	elseif not p.grinding then
		p.speed = math.max(8, p.speed - 0.6 * dt)
	end
	if p.charging then
		p.chargeT = math.min(MAX_CHARGE, p.chargeT + dt)
	end
	local jumpPop = Tuning.JUMP_POP

	if p.grinding then
		local r = p.grinding
		p.x = damp(p.x, r.x, 20, dt)
		p.y = r.top
		p.vx = 0
		p.heading = 0
		p.z -= p.speed * dt
		p.grindTime += dt
		if math.random() < 0.3 then
			Rider.emit(p.x, p.y + 0.05, p.z + 0.4, 2, Color3.fromHex("ffb347"), true)
		end
		if p.z < r.z0 - r.L then
			leaveRail(4)
		elseif inp.jump then
			leaveRail(jumpPop + 1)
		end
	elseif p.grounded then
		p.groundTime += dt
		-- carving: steer sets a heading; velocity follows the skis
		local maxHead = if board then 0.72 * clamp(26 / p.speed, 0.6, 1) else 0.62 * clamp(24 / p.speed, 0.55, 1)
		local targetHead = inp.h * maxHead
		if math.abs(p.x) > X_LIMIT - 1.5 and sign(p.x) == sign(if targetHead ~= 0 then targetHead else p.heading) then
			targetHead = -sign(p.x) * 0.25
		end
		p.heading = damp(p.heading, targetHead, if board then (if inp.h ~= 0 then 10 else 9) else (if inp.h ~= 0 then 7 else 8), dt)
		p.vx = math.sin(p.heading) * p.speed
		local prevX = p.x
		p.x += p.vx * dt
		p.z -= math.cos(p.heading) * p.speed * dt
		if math.abs(p.x) > X_LIMIT then
			p.x = sign(p.x) * X_LIMIT
			p.heading *= 0.5
		end
		local gh, gs = Course.groundAt(p.x, p.z)
		if gh - p.y > 1.3 then
			-- ran into the side wall of a ramp/tabletop: bounce off it instead of dying
			p.x = prevX - sign(p.vx) * 0.15
			p.heading = -p.heading * 0.4
			p.speed *= 0.85
			shake = 0.25
			if time - p.bonkT > 0.5 then
				p.bonkT = time
				showTrick("Bonk!", "", false)
			end
			return
		end
		local groundVy = gs * p.speed
		-- leave the snow off a lip, or when a crest drops away faster than gravity can pull you down
		if gh < p.y - 0.25 or (p.vy - groundVy) > G * 1.1 * dt + 0.6 then
			startAir()
		else
			p.y = gh
			p.vy = groundVy
		end
		if p.grounded and inp.jump then
			p.vy = math.max(p.vy, 0) + jumpPop * (if board then 1.15 else 1)
			if board then
				Rider.emit(p.x, p.y + 0.05, p.z + 0.6, 10, SNOW_WHITE) -- tail snap
			end
			startAir()
			Sfx.ollie()
		end
		if p.grounded then
			if Course.padAt(p.x, p.z, "bounce") then
				bounce()
			end
			local sp = Course.padAt(p.x, p.z, "boost")
			if sp and not sp.used then
				sp.used = true
				p.speed = math.min(p.speed + 13, Tuning.baseSpeed(-p.z) * 1.55)
				p.boostT = 1
				showTrick("Boost!", "", false)
				Sfx.trick(2)
				Rider.emit(p.x, 0.2, p.z, 24, Color3.fromHex("22d3ee"), true)
			end
		end
		if p.grounded then
			local r = Course.railAt(p.x, p.z)
			if r and r ~= p.lastRail then
				startGrind(r)
			end
		end
		if p.groundTime > 0.7 and not board then
			p.yaw = damp(p.yaw, math.round(p.yaw / TAU) * TAU, 3, dt) -- a board just rides switch
		end
		-- snowboard butter: hold W on the snow to press the nose; let go for points
		local butter = board and inp.v > 0.3 and not p.grinding
		if butter then
			p.butterT += dt
			if math.random() < 0.5 then
				Rider.emit(p.x, p.y + 0.05, p.z - 0.6, 2, SNOW_WHITE)
			end
		elseif p.butterT > 0.5 then
			award(if p.butterT > 1.5 then "Long Nose Butter" else "Nose Butter", 120 + math.round(p.butterT * 220), false)
			p.butterT = 0
		else
			p.butterT = 0
		end
		p.butter = butter
		if board and math.abs(p.heading) > 0.25 then
			Rider.emit(p.x - sign(p.heading) * 0.5, p.y + 0.05, p.z + 0.3, 3, SNOW_WHITE) -- edge spray
		end
		if math.abs(p.heading) > 0.3 and math.random() < 0.6 then
			Rider.emit(p.x - sign(p.heading) * 0.4, p.y + 0.05, p.z + 0.5, 2, SNOW_WHITE)
		end
		if p.comboTimer > 0 and not p.grinding then
			p.comboTimer -= dt
			if p.comboTimer <= 0 then
				p.combo = 0
			end
		end
	else
		-- airborne: keep the momentum you took off with
		p.airTime += dt
		p.x += p.vx * dt
		p.z -= math.cos(p.heading) * p.speed * dt
		if math.abs(p.x) > X_LIMIT then
			p.x = sign(p.x) * X_LIMIT
			p.vx = 0
		end
		local prevY = p.y
		p.vy -= G * (if p.vy < 0 then 1.15 else 1) * dt -- slightly heavier fall = snappier
		p.y += p.vy * dt
		p.maxH = math.max(p.maxH, p.y - gh0)
		p.grabbing = inp.grab and p.airTime > 0.12
		local mul = (if p.grabbing then 0.65 else 1) * trickMul
		-- just before touchdown the rider commits to the nearest landing
		local nearGround = p.vy < 0 and (p.y - gh0) / -p.vy < 0.2
		if nearGround then
			inp.v, inp.h = 0, 0
		end
		-- flip (W/S), spin (A/D), both together = sideflip toward the spin direction
		local diag = math.abs(inp.v) > 0.35 and math.abs(inp.h) > 0.35
		if diag then
			p.rollVel = damp(p.rollVel, -sign(inp.h) * ROLL_RATE * mul, 10, dt)
			p.pitchVel = settle(p.pitch, p.pitchVel, TAU, FLIP_RATE, dt)
			p.yawVel = settle(p.yaw, p.yawVel, math.pi, SPIN_RATE, dt)
		else
			p.rollVel = settle(p.roll, p.rollVel, TAU, ROLL_RATE, dt)
			if inp.v ~= 0 then
				p.pitchVel = damp(p.pitchVel, -inp.v * FLIP_RATE * mul * (if board then 0.92 else 1), 10, dt)
			else
				p.pitchVel = settle(p.pitch, p.pitchVel, TAU, FLIP_RATE, dt)
			end
			if inp.h ~= 0 then
				p.yawVel = damp(p.yawVel, -inp.h * SPIN_RATE * mul * (if board then 1.15 else 1), 10, dt)
			else
				p.yawVel = settle(p.yaw, p.yawVel, math.pi, SPIN_RATE, dt)
			end
		end
		p.pitch += p.pitchVel * dt
		p.yaw += p.yawVel * dt
		p.roll += p.rollVel * dt
		local t = p.trick
		if t then
			t.pitch += p.pitchVel * dt
			t.yaw += p.yawVel * dt
			t.roll += p.rollVel * dt
			if p.grabbing then
				t.grab += dt
				t.grabTotal += dt
			end
		end

		local r = if p.vy < 0 then Course.railAt(p.x, p.z) else nil
		if r and prevY >= r.top - 0.2 and p.y <= r.top + 0.1 then
			local lc = landingCheck()
			if not lc.ok then
				return crash("Slipped off the rail")
			end
			scoreAirTrick(lc.perfect)
			p.trick = nil
			startGrind(r)
		else
			local gh, gs = Course.groundAt(p.x, p.z)
			if p.y <= gh then
				p.y = gh
				land(gs)
				if p.crashed then
					return
				end
				if p.grounded and Course.padAt(p.x, p.z, "bounce") then
					bounce()
				end
			elseif p.y < -0.6 then
				return crash("Fell into a crevasse")
			end
		end
	end
	if p.grounded or p.grinding then
		p.lastRail = p.grinding or (if Course.railAt(p.x, p.z) then p.lastRail else nil)
	end

	-- obstacles
	for _, o in Course.obstacles do
		if o.dead then
			continue
		end
		local dz, dx = o.z - p.z, o.x - p.x
		if o.kind == "log" then
			if math.abs(dz) < 0.45 and math.abs(dx) < o.hw + 0.1 and p.y < o.h and (p.grounded or p.vy < 0) then
				return crash("Tripped over a log")
			end
			if not o.passed and p.z < o.z - 0.6 then
				o.passed = true
				if math.abs(dx) < o.hw + 0.3 and p.y >= o.h then
					p.trickScore += 100
					showTrick("Log hop!", "+100", false)
					Sfx.near()
				end
			end
			continue
		end
		if math.abs(dz) < o.r + 0.5 and math.abs(dx) < o.r + 0.32 and p.y < o.h then
			return crash(CRASH_REASONS[o.kind] or "Wiped out")
		end
		if not o.passed and p.z < o.z - o.r then
			o.passed = true
			if math.abs(dx) < o.r + 1.1 and p.y < o.h + 0.8 then
				p.trickScore += 50
				showTrick("Close call!", "+50", false)
				Sfx.near()
			end
		end
	end
	for _, c in Course.crevasses do
		if not c.passed and p.z < c.z0 - c.L then
			c.passed = true
			p.trickScore += 300
			showTrick("Crevasse cleared!", "+300", false)
			Sfx.trick(1)
		end
	end
end

-- Coins: tested along the rider's whole path this frame, so nothing tunnels past at 200 km/h.
local GOLD = Color3.fromHex("ffd23f")
local function collectCoins(x0: number, y0: number, z0: number)
	local x1, y1, z1 = p.x, p.y + 0.9, p.z
	y0 += 0.9
	local sx, sy, sz = x1 - x0, y1 - y0, z1 - z0
	local len2 = sx * sx + sy * sy + sz * sz
	if len2 == 0 then
		len2 = 1
	end
	for _, c in Course.coins do
		if c.taken or c.z < z1 - 3 or c.z > z0 + 3 then
			continue
		end
		-- closest point on this frame's path to the coin
		local t = clamp(((c.x - x0) * sx + (c.y - y0) * sy + (c.z - z0) * sz) / len2, 0, 1)
		local dx, dy, dz = c.x - (x0 + sx * t), (c.y - (y0 + sy * t)) * 0.75, c.z - (z0 + sz * t)
		if dx * dx + dy * dy + dz * dz < magnet * magnet then
			Course.takeCoin(c)
			p.coins += 1
			p.trickScore += 25
			Sfx.coin()
			Rider.emit(c.x, c.y, c.z, 8, GOLD, true)
		end
	end
end

local function updateCrash(dt: number)
	p.crashT += dt
	p.speed = damp(p.speed, 0, 1.6, dt)
	p.z -= p.speed * dt
	p.x += p.vx * dt
	p.vx = damp(p.vx, 0, 2, dt)
	local gh = Course.groundAt(p.x, p.z)
	p.vy -= G * dt
	p.y += p.vy * dt
	if p.y < gh then
		p.y = gh
		p.vy = if math.abs(p.vy) > 2 then -p.vy * 0.35 else 0
	end
	p.pitch += p.spinX * dt
	p.lean += p.spinZ * dt
	p.spinX = damp(p.spinX, 0, 1.2, dt)
	p.spinZ = damp(p.spinZ, 0, 1.2, dt)
	p.y = math.max(p.y, -3)
end

-- ---------- rider visuals ----------
local pose = { arms = p.arms }
local function updateSkierVisual(dt: number, hideUpper: boolean)
	local gh, gs = Course.groundAt(p.x, p.z)
	local targetTilt = if p.grounded and not p.crashed then math.atan(gs) else 0
	p.tilt = damp(p.tilt, targetTilt, 12, dt)
	p.slideYaw = damp(p.slideYaw, if p.grinding then math.pi / 2 else 0, 14, dt)
	local steerYaw = if p.crashed then 0 else -p.heading
	if not p.crashed then
		local leanK, leanMax = if board then 1.4 else 1, if board then 0.8 else 0.62
		p.lean = damp(p.lean, if p.grounded then clamp(-p.heading * clamp(p.speed / 25, 0.4, 1.2) * leanK, -leanMax, leanMax) else 0, 8, dt)
	end
	local targetCrouch = if p.crashed
		then 0.6
		elseif p.grabbing then 1
		elseif p.grinding then 0.45
		elseif p.grounded then 0.3 + math.min(0.25, p.speed / 140)
		else 0.45
	p.crouch = damp(p.crouch, targetCrouch, 10, dt)
	-- arms ease into each grab's own pose (or the riding pose)
	local gp = if p.grabbing and p.trick then GRAB_POSE[p.trick.grabName] else nil
	local ride = if board then { 0.1, -0.75, 0.1, 0.75 } else { 0.35, -0.18, 0.35 + 0.2 * math.sin(time * 6) * (if p.grounded then 0.3 else 0), 0.18 }
	local tgt = gp or ride
	local k = 1 - math.exp(-18 * dt)
	for i = 1, 4 do
		p.arms[i] += (tgt[i] - p.arms[i]) * k
	end
	p.arch = damp(p.arch, if gp then gp[5] elseif p.butter then 0.28 else 0, 10, dt)

	pose.x, pose.y, pose.z = p.x, p.y, p.z
	pose.yaw = p.yaw + p.slideYaw + steerYaw
	pose.pitch = p.pitch + p.tilt + p.arch
	pose.roll = p.lean + p.roll
	pose.crouch = p.crouch
	pose.shadowY = math.max(gh, 0)
	pose.shadowScale = math.max(0.35, 1 - math.max(0, p.y - gh) * 0.08)
	pose.showShadow = not p.grinding and not p.crashed and gh > -1
	pose.hideUpper = hideUpper
	pose.air = not p.grounded and not p.grinding and not p.crashed
	pose.grabbing = p.grabbing
	pose.grounded = p.grounded and not p.grinding and not p.crashed
	pose.speed = p.speed
	pose.steer = if p.crashed then 0 else p.heading
	pose.carve = p.lean
	pose.time = time
	pose.dt = dt
	Rider.pose(pose)
	Rider.setTracks(p.grounded and not p.crashed and (state == "play" or state == "countdown"))
end

-- ---------- camera ----------
local VIEWS = { "chase", "high", "first", "side" }
local VIEW_NAMES = { chase = "Chase cam", high = "High cam", first = "First person", side = "Side cam" }
local viewIdx = 1
local camPos = Vector3.zero
local camLook = Vector3.zero
local snapCam = true

local function currentView(): string
	local view = VIEWS[viewIdx]
	if view == "first" and (p.crashed or (state ~= "play" and state ~= "countdown")) then
		return "chase" -- tumbling in first person is unreadable
	end
	return view
end

local function dampV(a: Vector3, b: Vector3, kx: number, ky: number, kz: number, dt: number): Vector3
	return Vector3.new(damp(a.X, b.X, kx, dt), damp(a.Y, b.Y, ky, dt), damp(a.Z, b.Z, kz, dt))
end

local riding = false -- true from the countdown until back in the lobby
local function updateCamera(dt: number)
	if not riding then
		return -- the lobby uses Roblox's normal camera
	end
	camera.CameraType = Enum.CameraType.Scriptable
	local view = currentView()
	local fov
	if view == "first" then
		camera.CFrame = Rider.headCFrame(pose) * CFrame.Angles(-0.04, 0, 0)
		camPos = camera.CFrame.Position
		fov = 78
	else
		local y = math.max(0, p.y)
		local off, ahead
		if view == "high" then
			off, ahead = World.point(p.x * 0.6, y * 0.45 + 10, p.z + 15), World.point(p.x * 0.8, y * 0.6, p.z - 14)
		elseif view == "side" then
			off, ahead = World.point(p.x + 9, y * 0.7 + 2.4, p.z - 1), World.point(p.x, p.y + 1, p.z - 3)
		else
			off, ahead = World.point(p.x * 0.75, y * 0.55 + 4.4, p.z + 10), World.point(p.x * 0.85, y * 0.75 + 1.2, p.z - 9)
		end
		local k = if snapCam then 60 else 1
		camPos = dampV(camPos, off, 6 * k, 5 * k, 12 * k, dt)
		camLook = camLook:Lerp(ahead, 1 - math.exp(-10 * k * dt))
		local pos = camPos
		if shake > 0 then
			pos += Vector3.new(rand(-1, 1), rand(-1, 1), 0) * shake * 0.4 * World.S
			shake = math.max(0, shake - dt * 1.8)
		end
		-- a light buzz at high speed on the snow
		local buzz = if p.grounded and state == "play" then clamp((p.speed - 45) / 35, 0, 1) else 0
		if buzz > 0 then
			pos += Vector3.new(math.noise(time * 8, 1.3), math.noise(time * 8, 7.1), 0) * buzz * 0.06 * World.S
		end
		camera.CFrame = CFrame.lookAt(pos, camLook)
		fov = 64
	end
	fov += clamp((p.speed - 20) * 0.5, 0, 14) + p.boostT * 12
	camera.FieldOfView = damp(camera.FieldOfView, fov, 3, dt)
	snapCam = false
	Course.followCamera(camera.CFrame.Position)
end

-- ---------- server ----------
local function call(name: string, arg: any?)
	local ok, res = pcall(function()
		return Remotes.Action:InvokeServer(name, arg)
	end)
	if not ok then
		return { ok = false, msg = "Couldn't reach the server" }
	end
	return res or { ok = false }
end

local function applySettings(s)
	Sfx.setMuted(not s.sfx)
	Sfx.setMusic(s.music)
	Course.lowGfx = s.lowGfx
	viewIdx = table.find(VIEWS, s.view) or 1
end

local lastGear = ""
local function applyProfile(data)
	if not data then
		return
	end
	profile = data
	Menus.setProfile(data)
	applySettings(data.settings)
	local e = data.equipped
	local gearKey = table.concat({ e.skis, e.trails, e.boards, e.gear }, "/")
	if gearKey ~= lastGear then
		lastGear = gearKey
		Rider.setGear(Catalog.find(Catalog.skis, e.skis), Catalog.find(Catalog.trails, e.trails), Catalog.find(Catalog.boards, e.boards))
		Rider.setGearType(e.gear)
	end
end

local function refreshBoards()
	task.spawn(function()
		local ok, data = pcall(function()
			return Remotes.GetLeaderboards:InvokeServer()
		end)
		if ok and data then
			if data.profile then
				applyProfile(data.profile)
			end
			Menus.setBoards(data)
		end
	end)
end

Remotes.Profile.OnClientEvent:Connect(function(data, message)
	applyProfile(data)
	if message then
		Kit.toast(message, "info")
	end
end)
Remotes.Notify.OnClientEvent:Connect(function(message, kind)
	Kit.toast(message, kind)
	Sfx.reward()
end)

-- ---------- the player's own avatar ----------
local controls = nil
task.spawn(function()
	local ok, module = pcall(function()
		return require(player:WaitForChild("PlayerScripts"):WaitForChild("PlayerModule", 10) :: ModuleScript)
	end)
	if ok and module then
		controls = module:GetControls()
	end
end)
local function setControls(on: boolean)
	-- the player list would cover the run's HUD
	pcall(StarterGui.SetCoreGuiEnabled, StarterGui, Enum.CoreGuiType.PlayerList, on)
	if controls then
		if on then
			controls:Enable()
		else
			controls:Disable()
		end
	end
end

local function copyAvatar()
	local char = player.Character
	if char and not riding then
		Rider.setAvatar(char)
	end
end
player.CharacterAppearanceLoaded:Connect(function()
	task.wait(0.2)
	copyAvatar()
end)
-- the server dresses the character in its outfit; copy it again once that's done
local function watchOutfit(char: Model)
	char:GetAttributeChangedSignal("Outfit"):Connect(function()
		task.wait(0.3)
		copyAvatar()
	end)
end
player.CharacterAdded:Connect(watchOutfit)
if player.Character then
	watchOutfit(player.Character)
	task.defer(copyAvatar)
end

-- ---------- run flow ----------
local function buildRun()
	Course.reset()
	Course.setVisible(true)
	Course.update(0)
	resetPlayer()
	pose.arms = p.arms
	local up = profile.upgrades or {}
	magnet = Catalog.magnetRadius(up.magnet or 0)
	trickMul = Catalog.trickSpeed(up.spin or 0)
	p.speed += Catalog.headStart(up.start or 0)
	board = profile.equipped ~= nil and profile.equipped.gear == "board"
	Rider.setVisible(true)
	Rider.rebuild()
	Rider.clearTracks()
	jumpQueued = false
	table.clear(latched)
	paused = false
	Hud.reset()
	camPos = World.point(0, 6, 12)
	camLook = World.point(0, 0, -10)
	snapCam = true
end

local function startRide()
	if state ~= "lobby" and state ~= "over" then
		return
	end
	state = "starting"
	Kit.closeAll()
	Menus.hideResults()
	Hud.cover(Color3.new(1, 1, 1))
	Menus.showLobby(false)
	if not Rider.hasAvatar() then
		copyAvatar()
	end
	local res = call("rideStart")
	if not res.ok then
		Kit.toast(res.msg or "Couldn't start the run", "error")
	end
	riding = true
	setControls(false)
	buildRun()
	Sfx.musicVolume(0.18)
	state = "countdown"
	Hud.show(true, profile.settings.hints and (profile.runs or 0) < 5)
	Hud.flash(Color3.new(1, 1, 1), 0.6)
	Hud.countdown(function()
		if state == "countdown" then
			state = "play"
		end
	end)
end

local function runResult()
	return { score = totalScore(), coins = p.coins, dist = math.floor(-p.z), stats = p.stats }
end

local function gameOver()
	state = "over"
	paused = false
	Sfx.wind(0)
	Hud.hideRevive()
	Hud.show(false)
	local result = runResult()
	Menus.showResults({ score = result.score, dist = result.dist, coins = result.coins, reason = p.reason })
	task.spawn(function()
		local ok, rewards = pcall(function()
			return Remotes.RunFinished:InvokeServer(result)
		end)
		Menus.setRewards(if ok then rewards else nil)
		task.delay(2, refreshBoards)
	end)
end

local function toLobby()
	if state == "lobby" then
		return
	end
	local wasRiding = state == "play" or state == "crash" or state == "revive" or state == "countdown"
	state = "starting"
	paused = false
	Hud.showPause(false)
	Hud.hideRevive()
	Sfx.wind(0)
	if wasRiding then
		-- quitting mid-run still banks what you earned
		local result = runResult()
		task.spawn(function()
			local ok, rewards = pcall(function()
				return Remotes.RunFinished:InvokeServer(result)
			end)
			if ok and rewards and rewards.earned > 0 then
				Kit.toast("+" .. commas(rewards.earned) .. " coins banked", "coins")
			end
		end)
	end
	Hud.cover(Color3.new(1, 1, 1))
	call("rideEnd")
	riding = false
	Hud.show(false)
	Menus.hideResults()
	Course.clear()
	Course.setVisible(false)
	Rider.rebuild()
	Rider.setVisible(false)
	setControls(true)
	camera.CameraType = Enum.CameraType.Custom
	camera.FieldOfView = 70
	local hum = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if hum then
		camera.CameraSubject = hum
	end
	Sfx.musicVolume(0.35)
	state = "lobby"
	Menus.showLobby(true)
	Hud.flash(Color3.new(1, 1, 1), 0.6)
	refreshBoards()
end

-- Back on your feet after a crash: clear what you hit and carry on (from game.js respawn()).
local function revive()
	for _, c in Course.crevasses do
		if p.z <= c.z0 + 2 and p.z >= c.z0 - c.L - 2 then
			p.z = c.z0 - c.L - 3
		end
	end
	for _, o in Course.obstacles do
		if math.abs(o.z - p.z) < 8 then
			Course.removeObstacle(o)
		end
	end
	p.crashed = false
	p.y, p.vy, p.vx = 0, 0, 0
	p.speed = 16
	p.pitch, p.yaw, p.roll, p.rollVel, p.lean, p.heading = 0, 0, 0, 0, 0, 0
	p.grounded = true
	p.trick = nil
	p.grinding = nil
	p.pitchVel, p.yawVel = 0, 0
	p.combo, p.comboTimer = 0, 0
	p.x = clamp(p.x, -X_LIMIT, X_LIMIT)
	p.revives += 1
	Rider.rebuild()
	Hud.flash(Color3.new(1, 1, 1), 0.6)
	Sfx.revive()
	state = "play"
	showTrick("Back on your feet!", "", true)
end

-- Revives: free once a run with VIP, or with a revive already bought; otherwise bought with Robux.
local reviveProduct = Config.PRODUCT_IDS.revive or 0
local revivePrice: string? = nil
if reviveProduct ~= 0 then
	task.spawn(function()
		local ok, info = pcall(MarketplaceService.GetProductInfo, MarketplaceService, reviveProduct, Enum.InfoType.Product)
		if ok and info and info.PriceInRobux then
			revivePrice = tostring(info.PriceInRobux)
		end
	end)
end
local buyingRevive = false

local function reviveMode(): string?
	if p.revives >= Config.MAX_REVIVES then
		return nil
	end
	local vipFree = p.revives == 0 and profile.passes and profile.passes.vip
	if vipFree or (profile.reviveTokens or 0) > 0 then
		return "free"
	end
	return if reviveProduct ~= 0 then "robux" else nil
end

local function offerRevive()
	local mode = reviveMode()
	if not mode then
		return gameOver()
	end
	state = "revive"
	buyingRevive = false
	Hud.showRevive(p.reason, mode, revivePrice, 6)
	return
end

local function useRevive()
	local res = call("revive")
	if res.ok then
		Hud.hideRevive()
		revive()
	else
		Kit.toast(res.msg or "Couldn't revive", "error")
		gameOver()
	end
end

local function onRevive(yes: boolean)
	if state ~= "revive" or buyingRevive then
		return
	end
	if not yes then
		return gameOver()
	end
	if reviveMode() == "free" then
		return useRevive()
	end
	-- Robux: the server hands over the revive once Roblox confirms the purchase (Remotes.Revive)
	buyingRevive = true
	Hud.waitForPurchase()
	MarketplaceService:PromptProductPurchase(player, reviveProduct)
	return
end

Remotes.Revive.OnClientEvent:Connect(function()
	if state == "revive" and buyingRevive then
		buyingRevive = false
		useRevive()
	end
end)
MarketplaceService.PromptProductPurchaseFinished:Connect(function(_userId, productId, purchased)
	if productId == reviveProduct and not purchased and state == "revive" and buyingRevive then
		buyingRevive = false
		gameOver()
	end
end)

local function togglePause(force: boolean?)
	if state ~= "play" and state ~= "countdown" then
		return
	end
	paused = if force ~= nil then force else not paused
	Hud.showPause(paused)
	if paused then
		Sfx.wind(0)
	else
		Kit.closeAll()
	end
end

local function cycleView()
	viewIdx = viewIdx % #VIEWS + 1
	showTrick(VIEW_NAMES[VIEWS[viewIdx]], "", false)
	snapCam = true
	if profile.settings then
		profile.settings.view = VIEWS[viewIdx]
		task.spawn(call, "settings", profile.settings)
	end
end

-- ---------- input wiring ----------
local function inRun(): boolean
	return state == "play" or state == "countdown" or state == "crash"
end

UserInputService.InputBegan:Connect(function(input, processed)
	if input.UserInputType == Enum.UserInputType.Touch then
		return -- handled by TouchStarted below
	end
	local k = input.KeyCode
	if k == K.Unknown then
		return
	end
	if processed and k ~= K.ButtonA then
		return
	end
	keys[k] = true
	keyTime[k] = os.clock()
	latched[k] = nil
	if processed or not riding then
		return -- menus handle their own buttons; in the lobby the keys move your avatar
	end
	if JUMP_KEYS[k] and state == "play" then
		jumpQueued = true
	end
	if (k == K.G or k == K.ButtonY) and state == "play" then
		nextGrab()
	end
	if (k == K.P or k == K.ButtonStart) and (state == "play" or state == "countdown") then
		togglePause()
	end
	if (k == K.C or k == K.V or k == K.DPadUp) and inRun() then
		cycleView()
	end
	if state == "revive" and (k == K.Space or k == K.Return or k == K.ButtonA) and reviveMode() == "free" then
		onRevive(true)
	end
	if state == "over" and (k == K.Space or k == K.Return) then
		task.spawn(startRide)
	end
end)

UserInputService.InputEnded:Connect(function(input)
	local k = input.KeyCode
	keys[k] = nil
	latched[k] = nil
end)

UserInputService.InputChanged:Connect(function(input)
	if input.KeyCode == K.Thumbstick1 then
		local v = Vector2.new(input.Position.X, input.Position.Y)
		if math.abs(v.X) > 0.35 and math.abs(stick.X) <= 0.35 then
			stickHTime = os.clock()
		end
		if math.abs(v.X) <= 0.35 then
			stickLatchH = false
		end
		if math.abs(v.Y) <= 0.35 then
			stickLatchV = false
		end
		stick = v
	end
end)

local activeTouch: InputObject? = nil
UserInputService.TouchStarted:Connect(function(touch, processed)
	if processed or activeTouch or not riding then
		return
	end
	activeTouch = touch
	ptr.down = true
	ptr.x, ptr.y = touch.Position.X, touch.Position.Y
	ptr.sx, ptr.sy, ptr.ax, ptr.ay = ptr.x, ptr.y, ptr.x, ptr.y
	ptr.t0 = os.clock()
	ptr.moved = 0
end)
UserInputService.TouchMoved:Connect(function(touch)
	if touch ~= activeTouch then
		return
	end
	ptr.x, ptr.y = touch.Position.X, touch.Position.Y
	ptr.moved = math.max(ptr.moved, math.sqrt((ptr.x - ptr.sx) ^ 2 + (ptr.y - ptr.sy) ^ 2))
end)
UserInputService.TouchEnded:Connect(function(touch)
	if touch ~= activeTouch then
		return
	end
	activeTouch = nil
	if ptr.down and os.clock() - ptr.t0 < 0.26 and ptr.moved < 14 and state == "play" then
		jumpQueued = true
	end
	ptr.down = false
end)

-- pause when the Roblox menu opens or the window loses focus
GuiService.MenuOpened:Connect(function()
	togglePause(true)
end)
UserInputService.WindowFocusReleased:Connect(function()
	table.clear(keys)
	togglePause(true)
end)

-- lobby prompts: the start gate, the shop counter, the gift chest
ProximityPromptService.PromptTriggered:Connect(function(prompt, who)
	if who ~= player or state ~= "lobby" then
		return
	end
	if prompt.Name == "RidePrompt" then
		task.spawn(startRide)
	elseif prompt.Name == "ShopPrompt" then
		Menus.openShop("skis")
	elseif prompt.Name == "DailyPrompt" then
		Kit.open("daily")
	end
end)

-- ---------- frame ----------
local function frame(rawDt: number)
	local dt = math.min(0.033, rawDt)
	if state == "crash" and p.crashT < 0.45 then
		dt *= 0.3 -- brief slow-mo on impact
	end
	if not riding then
		Wind.clear()
	end
	if paused or not riding then
		return
	end
	time += dt
	if state == "play" then
		local x0, y0, z0 = p.x, p.y, p.z
		updatePlayer(dt)
		if state == "play" then
			collectCoins(x0, y0, z0)
		end
	elseif state == "crash" then
		updateCrash(dt)
		if p.crashT > 1.5 then
			offerRevive()
		end
	end
	if state == "play" then
		local delta = World.recenter(p.z)
		if delta then
			camPos += delta
			camLook += delta
			Rider.clearTracks()
		end
	end
	if state == "play" or state == "crash" then
		Course.update(p.z)
		Course.updateMovers(dt)
		Sfx.wind(if state == "play" then clamp(p.speed / 60, 0, 0.5) * (if p.grounded then 1 else 0.6) else 0)
	end
	if p.boostT > 0 then
		p.boostT = math.max(0, p.boostT - dt * 0.9)
		if state == "play" and math.random() < 0.5 then
			Rider.emit(p.x + rand(-0.4, 0.4), p.y + rand(0.2, 1.4), p.z + 0.8, 1, Color3.fromHex("22d3ee"), true)
		end
	end
	Course.updateCoins(time, p.z)
	Course.animatePads(time)
	updateSkierVisual(dt, currentView() == "first")
	updateCamera(dt)
	Wind.update(if state == "play" then clamp((p.speed - 24) / 34, 0, 1) else 0, dt)
	if state == "play" or state == "crash" or state == "countdown" then
		Hud.setScore(totalScore(), profile.best or 0)
		Hud.setCoins(p.coins)
		Hud.setDistance(math.max(0, math.floor(-p.z)))
		Hud.setSpeed(math.round(p.speed * 3.6), clamp(p.speed / (Tuning.baseSpeed(-p.z) * 1.3), 0, 1))
		local showCombo = p.combo > 1 and p.comboTimer > 0
		Hud.setCombo(showCombo, math.min(1 + 0.5 * (p.combo - 1), 8), p.comboTotal, p.comboTimer / COMBO_WINDOW)
	end
end

-- ---------- boot ----------
local gui = Instance.new("ScreenGui")
gui.Name = "PeakFlipUI"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = player:WaitForChild("PlayerGui")
-- shrink everything on small screens (phones)
local uiScale = Instance.new("UIScale")
uiScale.Parent = gui
local function rescale()
	local vp = camera.ViewportSize
	uiScale.Scale = math.clamp(math.min(vp.X / 1280, vp.Y / 760), 0.5, 1.15)
end
camera:GetPropertyChangedSignal("ViewportSize"):Connect(rescale)
rescale()

Kit.init(gui)
Hud.init(gui, {
	onPause = function()
		togglePause()
	end,
	onRevive = onRevive,
	onQuit = function()
		task.spawn(toLobby)
	end,
	onSettings = function()
		Kit.open("settings")
	end,
}, isTouch)
Menus.init(gui, {
	onPlay = function()
		task.spawn(startRide)
	end,
	onAgain = function()
		task.spawn(startRide)
	end,
	onLobby = function()
		task.spawn(toLobby)
	end,
	onAction = call,
	onSettings = function(s)
		applySettings(s)
		task.spawn(call, "settings", s)
	end,
	onRefreshBoards = refreshBoards,
})
Course.init()
Course.setVisible(false)
Rider.setVisible(false)
Menus.showLobby(true)
refreshBoards()
RunService:BindToRenderStep("PeakFlip", Enum.RenderPriority.Camera.Value + 1, frame)
