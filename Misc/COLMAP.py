import os
import subprocess
import argparse

def run_command(cmd):
    print(f"\nRunning: {cmd}")
    result = subprocess.run(cmd, shell=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {cmd}")

def main(image_dir, workspace):
    os.makedirs(workspace, exist_ok=True)

    database_path = os.path.join(workspace, "database.db")
    sparse_dir = os.path.join(workspace, "sparse")
    dense_dir = os.path.join(workspace, "dense")

    os.makedirs(sparse_dir, exist_ok=True)
    os.makedirs(dense_dir, exist_ok=True)

    # 1. Feature extraction
    run_command(
        f"colmap feature_extractor "
        f"--database_path {database_path} "
        f"--image_path {image_dir}"
    )

    # 2. Feature matching
    run_command(
        f"colmap exhaustive_matcher "
        f"--database_path {database_path}"
    )

    # 3. Sparse reconstruction (SfM)
    run_command(
        f"colmap mapper "
        f"--database_path {database_path} "
        f"--image_path {image_dir} "
        f"--output_path {sparse_dir}"
    )

    # 4. Image undistortion
    run_command(
        f"colmap image_undistorter "
        f"--image_path {image_dir} "
        f"--input_path {sparse_dir}/0 "
        f"--output_path {dense_dir} "
        f"--output_type COLMAP"
    )

    # 5. Dense stereo
    run_command(
        f"colmap patch_match_stereo "
        f"--workspace_path {dense_dir} "
        f"--workspace_format COLMAP "
        f"--PatchMatchStereo.geom_consistency true"
    )

    # 6. Fusion (point cloud generation)
    run_command(
        f"colmap stereo_fusion "
        f"--workspace_path {dense_dir} "
        f"--workspace_format COLMAP "
        f"--input_type geometric "
        f"--output_path {dense_dir}/fused.ply"
    )

    print("\nDone. Output point cloud:")
    print(f"{dense_dir}/fused.ply")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Photogrammetry pipeline using COLMAP")
    parser.add_argument("--images", required=True, help="Path to folder with images")
    parser.add_argument("--workspace", default="workspace", help="Output directory")

    args = parser.parse_args()
    main(args.images, args.workspace)