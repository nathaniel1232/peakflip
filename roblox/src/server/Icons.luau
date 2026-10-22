-- Turns the uploaded icon decals (shared/Icons.luau) into image ids the UI can show.
-- A decal is a wrapper around an image; loading it on the server reveals the image inside.
-- Results go into ReplicatedStorage.PeakFlip.IconImages as StringValues the clients watch.
local InsertService = game:GetService("InsertService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("PeakFlip")
local Icons = require(Shared:WaitForChild("Icons"))

local IconsServer = {}

function IconsServer.publish()
	local folder = Instance.new("Folder")
	folder.Name = "IconImages"
	folder.Parent = Shared
	for name, ref in Icons do
		task.spawn(function()
			local image: string? = nil
			if string.sub(ref, 1, 13) == "rbxassetid://" then
				image = ref
			else
				local id = tonumber(string.match(ref, "%d+"))
				local ok, model = pcall(InsertService.LoadAsset, InsertService, id)
				if ok and model then
					local decal = model:FindFirstChildWhichIsA("Decal", true)
					image = decal and decal.Texture
					model:Destroy()
				else
					warn("[PeakFlip] couldn't load icon", name, model)
				end
			end
			if image then
				local v = Instance.new("StringValue")
				v.Name = name
				v.Value = image
				v.Parent = folder
			end
		end)
	end
end

return IconsServer
