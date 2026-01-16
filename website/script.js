/**
 * Casino13 Bot - Website JavaScript
 */

document.addEventListener('DOMContentLoaded', function() {
    // ═══════════════════════════════════════════════════════════════════
    // MOBILE NAVIGATION
    // ═══════════════════════════════════════════════════════════════════
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');

    if (navToggle && navMenu) {
        navToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            navToggle.classList.toggle('active');
        });

        // Close menu when clicking a link
        navMenu.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                navToggle.classList.remove('active');
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // ACTIVE NAV LINK ON SCROLL
    // ═══════════════════════════════════════════════════════════════════
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');

    function updateActiveNav() {
        const scrollPos = window.scrollY + 100;

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            const sectionId = section.getAttribute('id');

            if (scrollPos >= sectionTop && scrollPos < sectionTop + sectionHeight) {
                navLinks.forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === `#${sectionId}`) {
                        link.classList.add('active');
                    }
                });
            }
        });
    }

    window.addEventListener('scroll', updateActiveNav);

    // ═══════════════════════════════════════════════════════════════════
    // SMOOTH SCROLL
    // ═══════════════════════════════════════════════════════════════════
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // ANIMATE ON SCROLL
    // ═══════════════════════════════════════════════════════════════════
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');

                // Animate progress bars when visible
                if (entry.target.classList.contains('detail-card')) {
                    const progressBars = entry.target.querySelectorAll('.progress-fill');
                    progressBars.forEach(bar => {
                        const width = bar.style.width;
                        bar.style.width = '0';
                        setTimeout(() => {
                            bar.style.width = width;
                        }, 100);
                    });
                }

                // Animate growth bars
                if (entry.target.classList.contains('growth-chart')) {
                    const bars = entry.target.querySelectorAll('.growth-bar');
                    bars.forEach((bar, index) => {
                        bar.style.opacity = '0';
                        bar.style.transform = 'scaleY(0)';
                        setTimeout(() => {
                            bar.style.transition = 'all 0.5s ease';
                            bar.style.opacity = '1';
                            bar.style.transform = 'scaleY(1)';
                            bar.style.transformOrigin = 'bottom';
                        }, index * 50);
                    });
                }
            }
        });
    }, observerOptions);

    // Observe elements
    document.querySelectorAll('.stat-card, .strategy-card, .detail-card, .pipeline-step, .growth-chart, .growth-stat-card').forEach(el => {
        observer.observe(el);
    });

    // ═══════════════════════════════════════════════════════════════════
    // NAVBAR BACKGROUND ON SCROLL
    // ═══════════════════════════════════════════════════════════════════
    const navbar = document.querySelector('.navbar');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(10, 10, 15, 0.95)';
        } else {
            navbar.style.background = 'rgba(10, 10, 15, 0.9)';
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    // COUNTER ANIMATION
    // ═══════════════════════════════════════════════════════════════════
    function animateCounter(element, target, suffix = '') {
        const duration = 2000;
        const start = 0;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic

            const current = start + (target - start) * easeProgress;

            if (target % 1 !== 0) {
                element.textContent = current.toFixed(1) + suffix;
            } else {
                element.textContent = Math.floor(current) + suffix;
            }

            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                element.textContent = target + suffix;
            }
        }

        requestAnimationFrame(update);
    }

    // Animate stat values when they come into view
    const statValues = document.querySelectorAll('.stat-value');
    const statsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.dataset.animated) {
                entry.target.dataset.animated = 'true';
                const text = entry.target.textContent;
                const number = parseFloat(text);

                if (!isNaN(number)) {
                    const suffix = text.replace(/[0-9.]/g, '');
                    animateCounter(entry.target, number, suffix);
                }
            }
        });
    }, { threshold: 0.5 });

    statValues.forEach(el => statsObserver.observe(el));

    // ═══════════════════════════════════════════════════════════════════
    // TOOLTIP FOR GROWTH BARS
    // ═══════════════════════════════════════════════════════════════════
    const growthBars = document.querySelectorAll('.growth-bar');

    growthBars.forEach(bar => {
        bar.addEventListener('mouseenter', function() {
            const win = this.dataset.win;
            const value = this.querySelector('.growth-value').textContent;

            // Create tooltip
            const tooltip = document.createElement('div');
            tooltip.className = 'tooltip';
            tooltip.innerHTML = `Win ${win}: ${value}`;
            tooltip.style.cssText = `
                position: absolute;
                top: -40px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.9);
                color: #00ff88;
                padding: 8px 12px;
                border-radius: 8px;
                font-size: 0.85rem;
                white-space: nowrap;
                z-index: 100;
                pointer-events: none;
            `;
            this.appendChild(tooltip);
        });

        bar.addEventListener('mouseleave', function() {
            const tooltip = this.querySelector('.tooltip');
            if (tooltip) tooltip.remove();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // LIVE STATUS SIMULATION (Optional - for demo)
    // ═══════════════════════════════════════════════════════════════════
    function updateLiveStatus() {
        const now = new Date();
        const hour = now.getUTCHours();

        // Check if in killzone
        const inLondon = hour >= 7 && hour < 10;
        const inNY = hour >= 13 && hour < 16;

        const badge = document.querySelector('.badge-live');
        if (badge) {
            if (inLondon || inNY) {
                badge.innerHTML = '<span class="pulse"></span> Trading Active';
                badge.style.borderColor = '#00ff88';
                badge.style.color = '#00ff88';
            } else {
                badge.innerHTML = '<span class="pulse"></span> Monitoring';
                badge.style.borderColor = '#00d4ff';
                badge.style.color = '#00d4ff';
            }
        }
    }

    updateLiveStatus();
    setInterval(updateLiveStatus, 60000); // Update every minute

    console.log('🎰 Casino13 Bot Website Loaded');
});
