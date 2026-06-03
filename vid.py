import cv2
import os

video_path = "vid.mp4"
output_dir = "frames"
os.makedirs(output_dir, exist_ok=True)

cap = cv2.VideoCapture(video_path)
frame_num = 0

while True:
    ret, frame = cap.read()
    if not ret:
        break
    cv2.imwrite(os.path.join(output_dir, f"frame_{frame_num:05d}.png"), frame)
    frame_num += 1

cap.release()
print(f"Extracted {frame_num} frames.")