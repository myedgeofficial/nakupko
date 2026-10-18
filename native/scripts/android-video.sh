#!/usr/bin/env bash
# Posnetek za Google Play (lokacija v ozadju). Zažene ga .github/workflows/android-video.yml v emulatorju.
set -x
mkdir -p "$OUT"
PKG=si.nakupko.app
n=0
shot() { n=$((n+1)); f=$(printf "%02d-%s" $n "$1"); adb exec-out screencap -p > "$OUT/$f.png"; adb exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's/UI hierchary dumped.*//' > "$OUT/$f.xml"; }
# Tapni prvi element, katerega besedilo ali opis ustreza regularnemu izrazu.
tap() {
  for i in 1 2 3 4 5 6; do
    adb exec-out uiautomator dump /dev/tty 2>/dev/null > /tmp/ui.xml
    xy=$(python3 - "$1" <<'PY'
import re, sys
x = open("/tmp/ui.xml", encoding="utf-8", errors="ignore").read()
for m in re.finditer(r'<node [^>]*>', x):
    n = m.group(0)
    t = (re.search(r' text="([^"]*)"', n) or [None, ""])[1] + " " + (re.search(r'content-desc="([^"]*)"', n) or [None, ""])[1]
    if re.search(sys.argv[1], t, re.I):
        b = list(map(int, re.findall(r'\d+', re.search(r'bounds="([^"]*)"', n).group(1))))
        print((b[0] + b[2]) // 2, (b[1] + b[3]) // 2); break
PY
)
    if [ -n "$xy" ]; then adb shell input tap $xy; sleep 2; return 0; fi
    sleep 2
  done
  echo "NI NAŠEL: $1"; return 1
}
geo() { for i in 1 2 3 4 5; do adb emu geo fix "$2" "$1"; sleep 2; done; }  # geo LAT LON

# Trgovina v Londonu (aplikacija je tam v angleščini) iz OpenStreetMap.
read SLAT SLON <<<"$(curl -s 'https://overpass-api.de/api/interpreter' --data-urlencode 'data=[out:json];node["shop"="supermarket"]["name"~"Tesco|Sainsbury"](51.505,-0.135,51.52,-0.115);out 1;' | python3 -c 'import json,sys; e=json.load(sys.stdin)["elements"][0]; print(e["lat"], e["lon"])')"
echo "Trgovina: $SLAT $SLON"
[ -z "$SLAT" ] && SLAT=51.5136 && SLON=-0.1365
HLAT=$(python3 -c "print($SLAT+0.012)"); HLON=$SLON

adb shell settings put system screen_off_timeout 1800000
adb shell svc power stayon true
adb shell cmd location set-location-enabled true
adb install -r "$APK"
geo $HLAT $HLON

adb shell screenrecord --bit-rate 8000000 --time-limit 175 /sdcard/v1.mp4 &
REC=$!
sleep 2
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1
sleep 10; shot zagon
# Samodejno skozi uvod in dovoljenja; okno z razlago (Turn on now) mora priti pred »Allow all the time«.
DONE=0
for i in $(seq 1 30); do
  adb exec-out uiautomator dump /dev/tty 2>/dev/null > /tmp/ui.xml
  if grep -q 'text="Wait"' /tmp/ui.xml; then tap '^Wait ?$'; continue; fi
  if grep -q 'Allow all the time' /tmp/ui.xml; then sleep 3; shot nastavitve; tap 'Allow all the time'; sleep 2; shot vedno; adb shell input keyevent KEYCODE_BACK; DONE=1; break; fi
  if grep -q 'Turn on now' /tmp/ui.xml; then shot razlaga; sleep 6; tap 'Turn on now'; sleep 3; continue; fi
  if grep -q 'While using the app' /tmp/ui.xml; then shot sistemsko; tap 'While using the app'; continue; fi
  if grep -q 'text="Allow"' /tmp/ui.xml; then tap '^Allow ?$'; continue; fi
  if grep -q "care about prices" /tmp/ui.xml; then tap "care about prices"; continue; fi
  if grep -q 'Younger' /tmp/ui.xml; then tap 'Younger'; continue; fi
  sleep 3; shot korak$i
done
echo "DONE=$DONE"
sleep 5; shot nazaj
# Izdelki na seznamu
if tap "What do you need to buy"; then
  for it in Milk Bread Eggs; do adb shell input text "$it"; adb shell input keyevent 66; sleep 2; done
fi
adb shell input keyevent KEYCODE_BACK; sleep 2; shot seznam
# Aplikacija zaprta, telefon gre v trgovino (drugi posnetek)
adb shell pkill -INT screenrecord; sleep 3; wait $REC; adb pull /sdcard/v1.mp4 "$OUT/v1.mp4"
adb shell screenrecord --bit-rate 8000000 --time-limit 175 /sdcard/v2.mp4 &
REC=$!
adb shell input keyevent KEYCODE_HOME; sleep 4
for i in $(seq 1 6); do adb emu geo fix $(python3 -c "print($SLON, $HLAT-($HLAT-$SLAT)*$i/6)"); sleep 4; done
for i in $(seq 1 15); do adb emu geo fix $SLON $SLAT; sleep 4; done
shot vTrgovini
adb shell cmd statusbar expand-notifications; sleep 6; shot obvestilo
adb shell cmd statusbar collapse; sleep 3
kill -INT $REC 2>/dev/null; adb shell pkill -INT screenrecord; sleep 3; wait $REC
adb pull /sdcard/v2.mp4 "$OUT/v2.mp4"
printf "file '%s'\nfile '%s'\n" "$OUT/v1.mp4" "$OUT/v2.mp4" > /tmp/list.txt
ffmpeg -y -f concat -safe 0 -i /tmp/list.txt -vf "scale=720:-2" -c:v libx264 -preset fast -crf 26 "$OUT/nakupko-lokacija.mp4" || cp "$OUT/v1.mp4" "$OUT/nakupko-lokacija.mp4"
adb shell dumpsys location | grep -i -A3 geofence | head -40 > "$OUT/geofence.txt" || true
adb logcat -d | grep -i "nakupko\|geofenc\|chromium" | tail -300 > "$OUT/logcat.txt" || true
ls -la "$OUT"
exit 0
