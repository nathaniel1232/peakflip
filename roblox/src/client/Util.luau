-- Small maths helpers shared by the client modules (ported from game.js).
local Util = {}

Util.TAU = math.pi * 2

function Util.lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end

function Util.clamp(v: number, a: number, b: number): number
	return math.max(a, math.min(b, v))
end

function Util.damp(a: number, b: number, k: number, dt: number): number
	return Util.lerp(a, b, 1 - math.exp(-k * dt))
end

local rng = Random.new()
function Util.rand(a: number, b: number): number
	return a + rng:NextNumber() * (b - a)
end
function Util.chance(p: number): boolean
	return rng:NextNumber() < p
end

-- wrap an angle into [-pi, pi)
function Util.wrap(a: number): number
	a = (a + math.pi) % Util.TAU
	if a < 0 then
		a += Util.TAU
	end
	return a - math.pi
end

function Util.sign(v: number): number
	return if v > 0 then 1 elseif v < 0 then -1 else 0
end

function Util.round(v: number): number
	return math.floor(v + 0.5)
end

-- 12345 -> "12,345"
function Util.commas(n: number): string
	local s = tostring(math.floor(n))
	local neg = string.sub(s, 1, 1) == "-"
	if neg then
		s = string.sub(s, 2)
	end
	local out = string.reverse((string.gsub(string.reverse(s), "(%d%d%d)", "%1,")))
	if string.sub(out, 1, 1) == "," then
		out = string.sub(out, 2)
	end
	return (if neg then "-" else "") .. out
end

return Util
