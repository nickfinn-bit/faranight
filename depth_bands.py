import cv2, numpy as np
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter1d

img = cv2.imread('TRDamage.png')
b,g,r = img[:,:,0].astype(int), img[:,:,1].astype(int), img[:,:,2].astype(int)
mask = (b>120)&(b<210)&(r<90)&(g>80)&(g<160)

# Calibration (pixel -> data)
# x: col 92 -> 160, col 523 -> 300
def px2x(c): return 160 + (c-92)*(300-160)/(523-92)
# y: row 10 -> 0.48, row 259 -> 0.34
def py2y(rw): return 0.48 + (rw-10)*(0.34-0.48)/(259-10)

H,W = mask.shape
xs_data, ys_data = [], []
for c in range(W):
    rows = np.where(mask[:,c])[0]
    if len(rows):
        xs_data.append(px2x(c))
        ys_data.append(py2y(rows.mean()))
xs_data=np.array(xs_data); ys_data=np.array(ys_data)
order=np.argsort(xs_data); xs_data=xs_data[order]; ys_data=ys_data[order]

# Resample onto regular grid + light smoothing
xg = np.linspace(xs_data.min(), xs_data.max(), 300)
yg = np.interp(xg, xs_data, ys_data)
yg = gaussian_filter1d(yg, 3)

# Bands ±0.05 mm
maxBand = yg + 0.05
minBand = yg - 0.05

# Second curve: same broad trend but noticeably different, mostly within bands.
np.random.seed(7)
t = (xg-xg.min())/(xg.max()-xg.min())
# larger, lower-frequency deviations + a slope tilt so it diverges from nominal
wobble = 0.045*np.sin(2*np.pi*t*1.4 + 0.8) \
       + 0.030*np.sin(2*np.pi*t*3.1 + 2.0) \
       + 0.020*(t-0.5)
curve2 = yg + wobble
# clip rare excursions so it stays mostly inside the bands
curve2 = np.clip(curve2, yg-0.055, yg+0.055)

np.savez('data.npz', xg=xg, yg=yg, maxBand=maxBand, minBand=minBand, curve2=curve2)

within = np.mean((curve2<=maxBand)&(curve2>=minBand))*100
print(f"curve2 within bands: {within:.1f}%  max dev {np.max(np.abs(curve2-yg)):.3f}")

fig, ax = plt.subplots(figsize=(7,4))
ax.fill_between(xg, minBand, maxBand, color='tab:blue', alpha=0.12, label='band ±0.05 mm')
ax.plot(xg, maxBand, '--', color='tab:blue', lw=1, label='maxBand (+0.05 mm)')
ax.plot(xg, minBand, '--', color='tab:blue', lw=1, label='minBand (−0.05 mm)')
ax.plot(xg, yg, color='tab:blue', lw=2, label='Nominal Damage')
# ax.plot(xg, curve2, color='tab:orange', lw=1.8, label='Rig Damage')
ax.set_xlabel('y (pixels, top to bottom)')
ax.set_ylabel('Depth (mm)')
ax.legend(fontsize=8, loc='upper center', ncol=2)
fig.tight_layout()
fig.savefig('depth_bands.png', dpi=150)
print("saved")
