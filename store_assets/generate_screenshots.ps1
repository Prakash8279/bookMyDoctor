Add-Type -AssemblyName System.Drawing

function Generate-PlayStoreImage {
    param(
        [string]$InputPath,
        [string]$OutputPath,
        [string]$BadgeText,
        [string]$MainHeading,
        [string]$SubHeading,
        [int]$TopR, [int]$TopG, [int]$TopB,
        [int]$BotR, [int]$BotG, [int]$BotB
    )

    $canvasWidth = 1080
    $canvasHeight = 1920

    $bitmap = New-Object System.Drawing.Bitmap($canvasWidth, $canvasHeight)
    $gfx = [System.Drawing.Graphics]::FromImage($bitmap)
    $gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # 1. Background Gradient
    $bgRect = New-Object System.Drawing.Rectangle(0, 0, $canvasWidth, $canvasHeight)
    $colorTop = [System.Drawing.Color]::FromArgb($TopR, $TopG, $TopB)
    $colorBot = [System.Drawing.Color]::FromArgb($BotR, $BotG, $BotB)
    $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, $colorTop, $colorBot, 90.0)
    $gfx.FillRectangle($gradient, $bgRect)
    $gradient.Dispose()

    # 2. Badge Pill (Brand)
    $badgeFont = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
    $badgeSize = $gfx.MeasureString($BadgeText, $badgeFont)
    $pillW = [int]$badgeSize.Width + 40
    $pillH = 48
    $pillX = ($canvasWidth - $pillW) / 2
    $pillY = 70

    $pillBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(45, 255, 255, 255))
    $pillPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 255, 255, 255), 2)
    $gfx.FillRectangle($pillBg, $pillX, $pillY, $pillW, $pillH)
    $gfx.DrawRectangle($pillPen, $pillX, $pillY, $pillW, $pillH)

    $centerFormat = New-Object System.Drawing.StringFormat
    $centerFormat.Alignment = [System.Drawing.StringAlignment]::Center
    $centerFormat.LineAlignment = [System.Drawing.StringAlignment]::Center

    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $gfx.DrawString($BadgeText, $badgeFont, $whiteBrush, ($canvasWidth / 2), ($pillY + ($pillH / 2)), $centerFormat)

    # 3. Main Title
    $titleFont = New-Object System.Drawing.Font("Segoe UI", 36, [System.Drawing.FontStyle]::Bold)
    $titleRect = New-Object System.Drawing.RectangleF(40, 140, 1000, 110)
    $gfx.DrawString($MainHeading, $titleFont, $whiteBrush, $titleRect, $centerFormat)

    # 4. Subtitle
    $subFont = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Regular)
    $subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 245, 255))
    $subRect = New-Object System.Drawing.RectangleF(60, 255, 960, 75)
    $gfx.DrawString($SubHeading, $subFont, $subBrush, $subRect, $centerFormat)

    # 5. Device Frame & Screenshot
    if (Test-Path $InputPath) {
        $screenImg = [System.Drawing.Image]::FromFile($InputPath)
        $frameW = 760
        $frameH = 1530
        $frameX = ($canvasWidth - $frameW) / 2
        $frameY = 360

        # Outer Shadow
        $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 0, 0, 0))
        $gfx.FillRectangle($shadowBrush, ($frameX - 10), ($frameY - 6), ($frameW + 20), ($frameH + 30))

        # Device Bezel
        $bezelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20, 26, 38))
        $gfx.FillRectangle($bezelBrush, $frameX, $frameY, $frameW, $frameH)

        # Phone Screen inside bezel
        $bezelThickness = 12
        $screenX = $frameX + $bezelThickness
        $screenY = $frameY + $bezelThickness
        $screenW = $frameW - ($bezelThickness * 2)
        $screenH = $frameH - ($bezelThickness * 2)

        $gfx.DrawImage($screenImg, $screenX, $screenY, $screenW, $screenH)

        # Camera Hole / Punch
        $holeW = 24
        $holeH = 24
        $holeX = ($canvasWidth - $holeW) / 2
        $holeY = $screenY + 12
        $holeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(10, 10, 10))
        $gfx.FillEllipse($holeBrush, $holeX, $holeY, $holeW, $holeH)

        $screenImg.Dispose()
    }

    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    $gfx.Dispose()
    Write-Host "Created: $OutputPath"
}

# 1. Screen 1: Home & Search
Generate-PlayStoreImage `
    -InputPath "store_assets/screenshot_1_home.png" `
    -OutputPath "store_assets/playstore_screen_1.png" `
    -BadgeText "BOOKMYDOCTORS" `
    -MainHeading "Find & Book Top Doctors" `
    -SubHeading "Instant clinic appointments with verified specialists near you" `
    -TopR 15 -TopG 118 -TopB 110 `
    -BotR 2 -BotG 132 -BotB 199

# 2. Screen 2: Doctor Search & Booking
Generate-PlayStoreImage `
    -InputPath "store_assets/screenshot_2_search.png" `
    -OutputPath "store_assets/playstore_screen_2.png" `
    -BadgeText "VERIFIED SPECIALISTS" `
    -MainHeading "Explore Doctors by Specialty" `
    -SubHeading "Compare qualifications, fees, and visiting hours transparently" `
    -TopR 2 -TopG 132 -TopB 199 `
    -BotR 30 -BotG 64 -BotB 175

# 3. Screen 3: Menu & Role Access
Generate-PlayStoreImage `
    -InputPath "store_assets/screenshot_3_menu.png" `
    -OutputPath "store_assets/playstore_screen_3.png" `
    -BadgeText "SMART HEALTHCARE" `
    -MainHeading "Live Queue & Token Status" `
    -SubHeading "Track your token in real-time and skip clinic waiting rooms" `
    -TopR 30 -TopG 64 -TopB 175 `
    -BotR 79 -BotG 70 -BotB 229

# 4. Screen 4: Appointments & Family Profiles
Generate-PlayStoreImage `
    -InputPath "store_assets/screenshot_4_profile.png" `
    -OutputPath "store_assets/playstore_screen_4.png" `
    -BadgeText "FAMILY HEALTHCARE" `
    -MainHeading "Manage Health for Your Family" `
    -SubHeading "Digital records, appointment reminders, and instant confirmations" `
    -TopR 13 -TopG 148 -TopB 136 `
    -BotR 14 -BotG 116 -BotB 144

# 5. Screen 5: Instant Booking & Slots
Generate-PlayStoreImage `
    -InputPath "store_assets/screenshot_2_search.png" `
    -OutputPath "store_assets/playstore_screen_5.png" `
    -BadgeText "INSTANT BOOKING" `
    -MainHeading "Book In Under 30 Seconds" `
    -SubHeading "Pick your preferred date and time slot with zero hassle" `
    -TopR 16 -TopG 185 -TopB 129 `
    -BotR 5 -BotG 150 -BotB 105

# 6. Screen 6: Clinic Network & Maps
Generate-PlayStoreImage `
    -InputPath "phone_drawer3.png" `
    -OutputPath "store_assets/playstore_screen_6.png" `
    -BadgeText "TRUSTED CLINICS" `
    -MainHeading "Find Verified Clinics Near You" `
    -SubHeading "Check clinic addresses, consultation facilities, and timings" `
    -TopR 217 -TopG 119 -TopB 6 `
    -BotR 194 -BotG 65 -BotB 12

# 7. Screen 7: Secure Payments
Generate-PlayStoreImage `
    -InputPath "store_assets/screenshot_1_home.png" `
    -OutputPath "store_assets/playstore_screen_7.png" `
    -BadgeText "100% SECURE PAYMENTS" `
    -MainHeading "Easy UPI & Card Payments" `
    -SubHeading "Pay consultation advance seamlessly with instant invoice generation" `
    -TopR 99 -TopG 102 -TopB 241 `
    -BotR 67 -BotG 56 -BotB 202

# 8. Screen 8: Digital Records & History
Generate-PlayStoreImage `
    -InputPath "store_assets/screenshot_4_profile.png" `
    -OutputPath "store_assets/playstore_screen_8.png" `
    -BadgeText "DIGITAL HEALTH" `
    -MainHeading "Your Records Always With You" `
    -SubHeading "Access past consultations, doctor notes, and prescriptions anytime" `
    -TopR 225 -TopG 29 -TopB 72 `
    -BotR 159 -BotG 18 -BotB 57
