#!/bin/bash

set -e

echo "🚀 Initializing MCP Playwright Automation..."
echo ""

# 1. Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env

    # Generate random MASTER_KEY (32 bytes = 64 hex chars)
    if command -v openssl &> /dev/null; then
        MASTER_KEY=$(openssl rand -hex 32)
        # Replace placeholder in .env
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s/your-32-character-master-key-here/$MASTER_KEY/" .env
        else
            # Linux
            sed -i "s/your-32-character-master-key-here/$MASTER_KEY/" .env
        fi
        echo "  ✓ Generated secure MASTER_KEY"
    else
        echo "  ⚠️  openssl not found. Please set MASTER_KEY manually in .env"
    fi

    echo "  ✓ Created .env file"
else
    echo "✓ .env file already exists"
fi

echo ""

# 2. Create necessary directories
echo "📁 Creating directories..."
node scripts/create-directories.ts || tsx scripts/create-directories.ts

echo ""
echo "✅ Initialization complete!"
echo ""
echo "Next steps:"
echo "  1. Review .env file and adjust if needed"
echo "  2. Run: npm run setup (to install models)"
echo "  3. Run: npm run build"
echo "  4. Run: npm run agent \"your first task\""
echo ""
