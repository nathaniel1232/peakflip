-- Dresses every player's character as the game's own rider: the same clean blocky body for
-- everyone, coloured and kitted out by their outfit (jacket, pants, hat, goggles, extras).
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("PeakFlip")
local Outfit = require(Shared:WaitForChild("Outfit"))

local Avatar = {}

-- Yields while Roblox rebuilds the body.
function Avatar.apply(char: Model, equipped)
	local hum = char:FindFirstChildOfClass("Humanoid")
	if not hum then
		return
	end
	local o = Outfit.resolve(equipped)
	local ok, err = pcall(hum.ApplyDescription, hum, Outfit.description(o))
	if not ok then
		warn("[PeakFlip] couldn't dress the character:", err)
	end
	if not char.Parent then
		return
	end
	Outfit.paint(char, o)
	Outfit.attach(char, o)
	-- tells the player's client to copy the newly dressed character for riding
	local key = {}
	for _, item in o do
		table.insert(key, item.id)
	end
	table.sort(key)
	char:SetAttribute("Outfit", table.concat(key, "/"))
end

return Avatar
