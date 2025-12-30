jQuery(document).ready(function($){

    //fix for stupid ie object cover
    if (document.documentMode || /Edge/.test(navigator.userAgent)) {
      jQuery('.featured-box-img-cover').each(function(){
          var t = jQuery(this),
              s = 'url(' + t.attr('src') + ')',
              p = t.parent(),
              d = jQuery('<div></div>');
  
          p.append(d);
          d.css({
              'height'                : '290',
              'background-size'       : 'cover',
              'background-repeat'     : 'no-repeat',
              'background-position'   : '50% 20%',
              'background-image'      : s
          });
          t.hide();
      });
    }

    // alertbar later
    $(document).scroll(function () {
        var y = $(this).scrollTop();
        if (y > 280) {
            $('.alertbar').fadeIn();
        } else {
            $('.alertbar').fadeOut();
        }
    });


    // Smooth on external page
    $(function() {
      setTimeout(function() {
        if (location.hash) {
          /* we need to scroll to the top of the window first, because the browser will always jump to the anchor first before JavaScript is ready, thanks Stack Overflow: http://stackoverflow.com/a/3659116 */
          window.scrollTo(0, 0);
          target = location.hash.split('#');
          smoothScrollTo($('#'+target[1]));
        }
      }, 1);

      // taken from: https://css-tricks.com/snippets/jquery/smooth-scrolling/
      $('a[href*=\\#]:not([href=\\#])').click(function() {
        if (location.pathname.replace(/^\//,'') == this.pathname.replace(/^\//,'') && location.hostname == this.hostname) {
          smoothScrollTo($(this.hash));
          return false;
        }
      });

      function smoothScrollTo(target) {
        target = target.length ? target : $('[name=' + this.hash.slice(1) +']');

        if (target.length) {
          $('html,body').animate({
            scrollTop: target.offset().top
          }, 1000);
        }
      }
    });
    
    
    // Hide Header on on scroll down
    var didScroll;
    var lastScrollTop = 0;
    var delta = 5;
    var navbarHeight = $('nav').outerHeight();

    $(window).scroll(function(event){
        didScroll = true;
    });

    setInterval(function() {
        if (didScroll) {
            hasScrolled();
            didScroll = false;
        }
    }, 250);

    function hasScrolled() {
        var st = $(this).scrollTop();
        
        // Make sure they scroll more than delta
        if(Math.abs(lastScrollTop - st) <= delta)
            return;

        // If they scrolled down and are past the navbar, add class .nav-up.
        // This is necessary so you never see what is "behind" the navbar.
        if (st > lastScrollTop && st > navbarHeight){
            // Scroll Down            
            $('nav').removeClass('nav-down').addClass('nav-up'); 
            $('.nav-up').css('top', - $('nav').outerHeight() + 'px');
           
        } else {
            // Scroll Up
            if(st + $(window).height() < $(document).height()) {               
                $('nav').removeClass('nav-up').addClass('nav-down');
                $('.nav-up, .nav-down').css('top', '0px');             
            }
        }

        lastScrollTop = st;
    }
        
    $('.site-content').css('margin-top', $('header').outerHeight() + 'px');  
    
    // spoilers
     $(document).on('click', '.spoiler', function() {
        $(this).removeClass('spoiler');
     });
    
    // Make headers clickable
    function makeHeadersClickable() {
        $('.article-post h1[id], .article-post h2[id], .article-post h3[id], .article-post h4[id], .article-post h5[id], .article-post h6[id]').each(function() {
            var $header = $(this);
            var headerId = $header.attr('id');
            
            $header.on('click', function() {
                window.location.hash = headerId;
                smoothScrollTo($header);
            });
        });
    }
    
    // Initialize clickable headers
    makeHeadersClickable();
    
    // Show copy tooltip
    function showCopyTooltip($element, message) {
        // Remove existing tooltip if any
        $('.copy-tooltip').remove();
        
        // Create and show new tooltip
        var $tooltip = $('<div>')
            .addClass('copy-tooltip')
            .text(message);
        
        // Position relative to the element
        $element.append($tooltip);
        
        // Trigger reflow to ensure transition works
        $tooltip[0].offsetHeight;
        
        $tooltip.addClass('show');
        
        // Hide after 1.5 seconds
        setTimeout(function() {
            $tooltip.removeClass('show');
            setTimeout(function() {
                $tooltip.remove();
            }, 200);
        }, 1500);
    }
    
    // Code copy functionality
    function addCodeCopyButtons() {
        // Find all code blocks in article posts (Prism.js structure)
        $('.article-post pre[class*="language-"]').each(function() {
            var $pre = $(this);

            // Create copy button with icon
            var copyIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
            var checkIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" stroke-width="2"/></svg>';

            var $copyButton = $('<button>')
                .addClass('code-copy-btn')
                .html(copyIcon)
                .attr('aria-label', 'Copy code to clipboard');

            // Add click handler
            $copyButton.on('click', function(e) {
                e.preventDefault();
                e.stopPropagation();

                // Get the code text from the code element inside pre
                var $code = $pre.find('code');
                var codeText = $code.length > 0 ? $code.text() : $pre.text();

                // Copy to clipboard
                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(codeText).then(function() {
                        showCodeCopySuccess($copyButton, checkIcon, copyIcon);
                    }).catch(function() {
                        fallbackCopyCode(codeText, $copyButton, checkIcon, copyIcon);
                    });
                } else {
                    fallbackCopyCode(codeText, $copyButton, checkIcon, copyIcon);
                }
            });

            // Append button directly to the pre element
            $pre.append($copyButton);
        });
    }
    
    // Fallback copy method for code
    function fallbackCopyCode(text, $button, checkIcon, copyIcon) {
        var $temp = $('<textarea>');
        $('body').append($temp);
        $temp.val(text).select();
        
        try {
            document.execCommand('copy');
            showCodeCopySuccess($button, checkIcon, copyIcon);
        } catch (err) {
            console.error('Failed to copy code');
        }
        
        $temp.remove();
    }
    
    // Show copy success feedback
    function showCodeCopySuccess($button, checkIcon, copyIcon) {
        // Show tooltip similar to header copy
        showCopyTooltip($button, 'Copied!');
        
        // Change icon to checkmark
        $button.html(checkIcon).addClass('copied');
        
        // Revert to copy icon after 1 second
        setTimeout(function() {
            $button.html(copyIcon).removeClass('copied');
            $button.blur(); // Remove focus to reset border color
        }, 1000);
    }
    
    // Initialize code copy buttons
    addCodeCopyButtons();
    
    // Future post visibility management
    function manageFuturePostVisibility() {
        // Only run in production environment
        var $futureCards = $('.card-group[data-post-future="true"]');
        
        if ($futureCards.length === 0) {
            return; // No future post management needed
        }
        
        // Get current UTC timestamp
        var now = new Date();
        var currentUTCTimestamp = Math.floor(now.getTime() / 1000);
        
        $futureCards.each(function() {
            var $card = $(this);
            // Post timestamps from Jekyll are already in UTC (Unix timestamps are always UTC)
            var postTimestamp = parseInt($card.attr('data-post-date'), 10);
            
            if (postTimestamp > currentUTCTimestamp) {
                // Post is in the future - hide it
                $card.addClass('future-post-hidden');
            } else {
                // Post date has passed - show it
                $card.removeClass('future-post-hidden');
            }
        });
    }
    
    // Initialize future post management
    manageFuturePostVisibility();
    
 });   

// deferred style loading
var loadDeferredStyles = function () {
	var addStylesNode = document.getElementById("deferred-styles");
	var replacement = document.createElement("div");
	replacement.innerHTML = addStylesNode.textContent;
	document.body.appendChild(replacement);
	addStylesNode.parentElement.removeChild(addStylesNode);
};
var raf = window.requestAnimationFrame || window.mozRequestAnimationFrame ||
	window.webkitRequestAnimationFrame || window.msRequestAnimationFrame;
if (raf) raf(function () {
	window.setTimeout(loadDeferredStyles, 0);
});
else window.addEventListener('load', loadDeferredStyles);
