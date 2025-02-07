#!/bin/bash

# Copy shared libraries
echo "Copying shared libraries..."
cp -r ../shared ./shared

# Build Docker image
echo "Building Docker image..."
docker build -t postiz-backend .

# Clean up
echo "Cleaning up..."
rm -rf ./shared

echo "Build complete!"
