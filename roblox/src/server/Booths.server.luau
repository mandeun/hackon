--!strict
-- 열린 대회 부스. hackon.kr 의 공개 목록(/api/events — 운영자가 «목록에 올린» 대회만)을 10분마다 읽어
-- 대회마다 부스 하나를 세운다. 연락처·열쇠는 그 응답에 애초에 없다.
-- 필요: 게임 설정 → 보안 → «HTTP 요청 허용» 켜기.
-- 로블록스 정책상 게임 밖 링크를 누르게 할 수 없다(13세 미만 포함). 부스는 «무엇이·언제» 만 보이고,
-- 신청은 각자 hackon.kr 에서 한다 — 주소를 클릭 단추로 만들지 않는다.

local HttpService = game:GetService("HttpService")

local API = "https://hackon.kr/api/events"
local EVERY = 600

local INK = Color3.fromRGB(11, 16, 32)
local LIME = Color3.fromRGB(200, 245, 59)
local WHITE = Color3.fromRGB(255, 255, 255)

local folder = Instance.new("Folder")
folder.Name = "EventBooths"
folder.Parent = workspace

type Ev = { id: string, title: string, host: string?, starts: string?, place: string?, teams: number? }

local function daysUntil(ymd: string?): string
	if not ymd then
		return "날짜 모름" -- 모르는 것은 모른다고 쓴다
	end
	local y, m, d = string.match(ymd, "^(%d+)-(%d+)-(%d+)")
	if not y then
		return "날짜 모름"
	end
	local t = os.time({ year = tonumber(y) :: number, month = tonumber(m) :: number, day = tonumber(d) :: number, hour = 0 })
	local n = math.floor((t - os.time()) / 86400 + 0.5)
	if n < 0 then
		return "지남"
	elseif n == 0 then
		return "오늘"
	end
	return "D-" .. n
end

local function booth(ev: Ev, i: number)
	local p = Instance.new("Part")
	p.Name = "Booth_" .. ev.id
	p.Size = Vector3.new(14, 10, 1)
	p.Anchored = true
	p.Color = INK
	-- 광장 둘레에 반원으로 늘어놓는다
	local a = math.rad(-60 + (i - 1) * 24)
	p.CFrame = CFrame.new(math.sin(a) * 55, 6, math.cos(a) * 55 - 10) * CFrame.Angles(0, a + math.pi, 0)
	p.Parent = folder
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.Parent = p
	local function line(text: string, y: number, h: number, color: Color3)
		local l = Instance.new("TextLabel")
		l.Size = UDim2.new(0.92, 0, h, 0)
		l.Position = UDim2.new(0.04, 0, y, 0)
		l.BackgroundTransparency = 1
		l.TextScaled = true
		l.TextWrapped = true
		l.Font = Enum.Font.GothamBold
		l.TextColor3 = color
		l.Text = text
		l.Parent = gui
	end
	line(ev.title, 0.06, 0.38, WHITE)
	line(daysUntil(ev.starts) .. (ev.starts and (" · " .. ev.starts) or ""), 0.48, 0.18, LIME)
	line((ev.host or "") .. (ev.place and (" · " .. ev.place) or ""), 0.68, 0.12, WHITE)
	line("신청은 hackon.kr 에서", 0.84, 0.1, LIME)
end

local function refresh()
	local ok, body = pcall(function()
		return HttpService:GetAsync(API)
	end)
	if not ok then
		warn("[HACK:ON] 목록을 못 읽었습니다 — 지난 부스를 그대로 둡니다", body)
		return -- 못 읽었다고 부스를 지우지 않는다(모름 ≠ 없음)
	end
	local okj, data = pcall(function()
		return HttpService:JSONDecode(body)
	end)
	if not okj then
		return
	end
	local rows: { Ev } = (typeof(data) == "table" and (data.rows or data)) :: any
	folder:ClearAllChildren()
	for i, ev in ipairs(rows) do
		if i > 6 then
			break
		end
		booth(ev, i)
	end
end

task.spawn(function()
	while true do
		refresh()
		task.wait(EVERY)
	end
end)
