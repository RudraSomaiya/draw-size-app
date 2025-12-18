import cv2
import numpy as np

# --- CONFIGURATION ---
IMAGE_PATH = 'Sample image-2.jpg' 
TOLERANCE = 50 # Default is 40

# Global variables
img = None
display_img = None
current_mask = None # New variable to hold the mask for saving

def on_mouse_click(event, x, y, flags, param):
    global display_img, img, current_mask

    if event == cv2.EVENT_LBUTTONDOWN:
        work_img = img.copy()
        h, w = img.shape[:2]
        
        # Mask must be +2 pixels larger than image
        mask = np.zeros((h+2, w+2), np.uint8)

        # Tolerance settings
        lo_diff = (TOLERANCE, TOLERANCE, TOLERANCE)
        up_diff = (TOLERANCE, TOLERANCE, TOLERANCE)

        # Flood Fill execution
        flags = 4 | cv2.FLOODFILL_FIXED_RANGE | cv2.FLOODFILL_MASK_ONLY | (255 << 8)
        cv2.floodFill(work_img, mask, (x, y), (0, 255, 0), lo_diff, up_diff, flags)

        # Extract the proper mask size
        current_mask = mask[1:-1, 1:-1]
        
        # --- Visualization (Green Overlay) ---
        overlay = img.copy()
        # Apply green where mask is 255
        overlay[current_mask == 255] = [0, 255, 0] 
        display_img = cv2.addWeighted(img, 0.7, overlay, 0.3, 0)
        
        cv2.imshow("Fuzzy Select", display_img)

def save_selection():
    """Saves the selected area with a transparent background."""
    if current_mask is None:
        print("No selection made yet! Click on the image first.")
        return

    # 1. Split the original image into Blue, Green, Red channels
    b, g, r = cv2.split(img)

    # 2. The 'current_mask' becomes our Alpha channel
    # (255 is opaque/visible, 0 is transparent)
    alpha = current_mask

    # 3. Merge them back into a 4-channel image (BGRA)
    four_channel_img = cv2.merge([b, g, r, alpha])

    # 4. Save as PNG (JPG does not support transparency)
    filename = "selection_cutout.png"
    cv2.imwrite(filename, four_channel_img)
    print(f"Saved cutout to: {filename}")

def main():
    global img, display_img

    img = cv2.imread(IMAGE_PATH)
    if img is None:
        print(f"Error loading {IMAGE_PATH}")
        return

    display_img = img.copy()

    cv2.namedWindow("Fuzzy Select")
    cv2.setMouseCallback("Fuzzy Select", on_mouse_click)

    print("Controls:")
    print(" > [Click] : Select area")
    print(" > [s]     : Save selection as transparent PNG")
    print(" > [q]     : Quit")

    while True:
        cv2.imshow("Fuzzy Select", display_img)
        
        key = cv2.waitKey(1) & 0xFF
        
        if key == ord('q'):
            break
        elif key == ord('s'):
            save_selection()

    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()