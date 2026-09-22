
Long recordings: need to record more than 5 min without losing audio or getting stuck on upload.
Solution 1: Cut our own recording into small pieces (segment-and-retry)
	Record ~60s, stop, save that piece, start recording again right away for the next piece.
	Tradeoff: every stop+start makes a real gap in the audio (~0.5s), sometimes cutting a word in half. Can't be removed with the tools uni-app gives us on the App platform — no way to know when the user is pausing (no live volume/frame API on App platform), and no way to pause/resume instead of a full stop (also not supported on App platform).
Solution 2: Record continuously, no stop at all (needs native plugin)
	A native plugin keeps the mic open the whole time and hands us the audio in small pieces on its own, so there's never a real stop.
	Spent hours waiting for a cloud build, and it failed: the iOS code had 7 real compiler errors (calling things that don't exist in Swift, wrong types, etc). Plugin does not work at all right now.
	Tradeoff: if it worked, this fully removes the gap and the lost-word problem. But it needs real native (Swift/Kotlin) code, which is much harder to build and test than our own JS code, and the one ready-made option we tried is broken.
Our selection: Solution 1 (segment-and-retry). It's already built, it's reliable, and the gap is a small/bounded problem compared to what we were originally fixing (losing whole recordings, stuck uploads). Good enough for now.
Future todo (not done, just ideas):
	Try writing our own small native plugin later, using local Xcode builds (fast, minutes) instead of cloud packaging (slow, hours) so we can actually debug it.
	Only worth it if users actually complain about the gap in real usage — don't build it just because it's possible.



Couldn't run the app on a real ios device in debug mode.V
	Couldn't do that even with PiggyNotebook.
	Update HBuilder.
	Certificate expired.
	Updated certificates and provision files. -> Fixed the problem.



