(function() {
    'use strict';
    // deferredSetup.js must be loaded first

    R.deferredRender = function(state) {
        if (!aborted && (
            !R.progCopy ||
            !R.progRed ||
            !R.progClear ||
            !R.prog_Ambient ||
            !R.prog_BlinnPhong_PointLight ||
            !R.prog_Debug ||
            !R.progPost1)) {
            console.log('waiting for programs to load...');
            return;
        }

        // Move the R.lights
        for (var i = 0; i < R.lights.length; i++) {
            // OPTIONAL TODO: Edit if you want to change how lights move
            var mn = R.light_min[1];
            var mx = R.light_max[1];
            R.lights[i].pos[1] = (R.lights[i].pos[1] + R.light_dt - mn + mx) % mx + mn;
        }

        // Execute deferred shading pipeline

        // CHECKITOUT: START HERE! You can even uncomment this:
        //debugger;
        /*
        { // TODO: this block should be removed after testing renderFullScreenQuad
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            renderFullScreenQuad(R.progRed);
            return;
        }
        */

        R.pass_copy.render(state);

        if (cfg && cfg.debugView >= 0) {
            // Do a debug render instead of a regular render
            // Don't do any post-processing in debug mode
            R.pass_debug.render(state);
        } else if (cfg && cfg.debugScissor){
            R.pass_deferred.renderScissor(state);
        } else {
            // * Deferred pass and postprocessing pass(es)
            R.pass_deferred.render(state);
            if (cfg.effects == -1){
                R.pass_post1.directRender(state);
            } else if (cfg.effects == 0){
                R.pass_post1.render(state);
                R.pass_post2.render(state);
            } else if (cfg.effects == 1){
                R.pass_postT1.render(state);
                R.pass_postT2.render(state);
            }
        }
    };

    /**
     * 'copy' pass: Render into g-buffers
     */
    R.pass_copy.render = function(state) {
        // * Bind the framebuffer R.pass_copy.fbo
        gl.bindFramebuffer(gl.FRAMEBUFFER, R.pass_copy.fbo);

        // * Clear screen using R.progClear
        renderFullScreenQuad(R.progClear);
        // * Clear depth buffer to value 1.0 using gl.clearDepth and gl.clear
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        // * "Use" the program R.progCopy.prog
        gl.useProgram(R.progCopy.prog);

        // * Upload the camera matrix m to the uniform R.progCopy.u_cameraMat
        //   using gl.uniformMatrix4fv
        gl.uniformMatrix4fv(R.progCopy.u_cameraMat, false, state.cameraMat.elements);

        // * Draw the scene
        drawScene(state);
    };

    var drawScene = function(state) {
        for (var i = 0; i < state.models.length; i++) {

            // If you want to render one model many times, note:
            // readyModelForDraw only needs to be called once.
            readyModelForDraw(R.progCopy, state.models[i]);
            
            drawReadyModel(state.models[i]);
        }
    };

    R.pass_debug.render = function(state) {
        // * Unbind any framebuffer, so we can write to the screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // * Bind/setup the debug "lighting" pass
        // * Tell shader which debug view to use
        bindTexturesForLightPass(R.prog_Debug);
        gl.uniform1i(R.prog_Debug.u_debug, cfg.debugView);

        // * Render a fullscreen quad to perform shading on
        renderFullScreenQuad(R.prog_Debug);
    };

    /**
     * 'deferred' pass: Scissor test debug view
     */
    R.pass_deferred.renderScissor = function(state) {
        // * Bind R.pass_deferred.fbo to write into for later postprocessing
        //gl.bindFramebuffer(gl.FRAMEBUFFER, R.pass_deferred.fbo);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // * Clear depth to 1.0 and color to black
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clearDepth(1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // * _ADD_ together the result of each lighting pass
        
        // Enable blending and use gl.blendFunc to blend with:
        //   color = 1 * src_color + 1 * dst_color
        gl.blendFunc(gl.SRC_ALPHA, gl.DST_ALPHA);
        gl.enable(gl.BLEND);

        // A loop here, over the values in R.lights, which sets the
        //   uniforms R.prog_BlinnPhong_PointLight.u_lightPos/Col/Rad etc.,
        //   then does renderFullScreenQuad(R.prog_BlinnPhong_PointLight).

        // In the lighting loop, use the scissor test optimization
        // Enable gl.SCISSOR_TEST, render all lights, then disable it.
        //
        // getScissorForLight returns null if the scissor is off the screen.
        // Otherwise, it returns an array [xmin, ymin, width, height].
        //
        //   var sc = getScissorForLight(state.viewMat, state.projMat, light);
        gl.enable(gl.SCISSOR_TEST);

        for (var i = R.lights.length - 1; i >= 0; i--) {
            var L = R.lights[i];
            var sc;
            if (cfg.improvedAABB){
                var sc = getScissorForLightI(state.viewMat, state.projMat, L);
            } else {
                var sc = getScissorForLight(state.viewMat, state.projMat, L);
            }
            if (sc != null){
                gl.scissor(sc[0], sc[1], sc[2], sc[3]);
                renderFullScreenQuad(R.progRed);
            }
        };

        gl.disable(gl.SCISSOR_TEST);
        // Disable blending so that it doesn't affect other code
        gl.disable(gl.BLEND);
    };

    /**
     * 'deferred' pass: Add lighting results for each individual light
     */
    R.pass_deferred.render = function(state) {
        // * Bind R.pass_deferred.fbo to write into for later postprocessing
        gl.bindFramebuffer(gl.FRAMEBUFFER, R.pass_deferred.fbo);
        //gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // * Clear depth to 1.0 and color to black
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clearDepth(1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // * _ADD_ together the result of each lighting pass
        
        // Enable blending and use gl.blendFunc to blend with:
        //   color = 1 * src_color + 1 * dst_color
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.enable(gl.BLEND);

        // * Bind/setup the ambient pass, and render using fullscreen quad
        bindTexturesForLightPass(R.prog_Ambient);
        renderFullScreenQuad(R.prog_Ambient);

        // * Bind/setup the Blinn-Phong pass, and render using fullscreen quad
        bindTexturesForLightPass(R.prog_BlinnPhong_PointLight);

        // A loop here, over the values in R.lights, which sets the
        //   uniforms R.prog_BlinnPhong_PointLight.u_lightPos/Col/Rad etc.,
        //   then does renderFullScreenQuad(R.prog_BlinnPhong_PointLight).

        // In the lighting loop, use the scissor test optimization
        // Enable gl.SCISSOR_TEST, render all lights, then disable it.
        //
        // getScissorForLight returns null if the scissor is off the screen.
        // Otherwise, it returns an array [xmin, ymin, width, height].
        //
        //   var sc = getScissorForLight(state.viewMat, state.projMat, light);

        if (cfg.scissoring){
            gl.enable(gl.SCISSOR_TEST);
            
            for (var i = R.lights.length - 1; i >= 0; i--) {
                var L = R.lights[i];
                var sc;
                if (cfg.improvedAABB){
                    var sc = getScissorForLightI(state.viewMat, state.projMat, L);
                } else {
                    var sc = getScissorForLight(state.viewMat, state.projMat, L);
                }
                if (sc != null){
                    gl.scissor(sc[0], sc[1], sc[2], sc[3]);

                    gl.uniform1i(R.prog_BlinnPhong_PointLight.u_toon, cfg.effects);

                    gl.uniform3f(R.prog_BlinnPhong_PointLight.u_lightPos, L.pos[0], L.pos[1], L.pos[2]);
                    gl.uniform3f(R.prog_BlinnPhong_PointLight.u_lightCol, L.col[0], L.col[1], L.col[2]);
                    gl.uniform1f(R.prog_BlinnPhong_PointLight.u_lightRad, L.rad);
                    gl.uniform3f(R.prog_BlinnPhong_PointLight.u_camPos, state.cameraPos[0], state.cameraPos[1], state.cameraPos[2]);
                    renderFullScreenQuad(R.prog_BlinnPhong_PointLight);
                }
            };

            gl.disable(gl.SCISSOR_TEST);
        } else {
            for (var i = R.lights.length - 1; i >= 0; i--) {
                var L = R.lights[i];
                gl.uniform1i(R.prog_BlinnPhong_PointLight.u_toon, cfg.effects);

                gl.uniform3f(R.prog_BlinnPhong_PointLight.u_lightPos, L.pos[0], L.pos[1], L.pos[2]);
                gl.uniform3f(R.prog_BlinnPhong_PointLight.u_lightCol, L.col[0], L.col[1], L.col[2]);
                gl.uniform1f(R.prog_BlinnPhong_PointLight.u_lightRad, L.rad);
                gl.uniform3f(R.prog_BlinnPhong_PointLight.u_camPos, state.cameraPos[0], state.cameraPos[1], state.cameraPos[2]);
                renderFullScreenQuad(R.prog_BlinnPhong_PointLight);
            };
        }
        // Disable blending so that it doesn't affect other code
        gl.disable(gl.BLEND);
    };

    var bindTexturesForLightPass = function(prog) {
        gl.useProgram(prog.prog);

        // * Bind all of the g-buffers and depth buffer as texture uniform
        //   inputs to the shader
        for (var i = 0; i < R.NUM_GBUFFERS; i++) {
            gl.activeTexture(gl['TEXTURE' + i]);
            gl.bindTexture(gl.TEXTURE_2D, R.pass_copy.gbufs[i]);
            gl.uniform1i(prog.u_gbufs[i], i);
        }
        gl.activeTexture(gl['TEXTURE' + R.NUM_GBUFFERS]);
        gl.bindTexture(gl.TEXTURE_2D, R.pass_copy.depthTex);
        gl.uniform1i(prog.u_depth, R.NUM_GBUFFERS);
    };

    /**
     * 'post0' pass: Direct render
     */
    R.pass_post1.directRender = function(state) {
        // * Unbind any existing framebuffer (if there are no more passes)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // * Clear the framebuffer depth to 1.0
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        // * Bind the postprocessing shader program
        gl.useProgram(R.progPostDirect.prog);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, R.pass_deferred.colorTex);
        gl.uniform1i(R.progPostDirect.u_color, 0);

        renderFullScreenQuad(R.progPostDirect);
    };

    /********************************************************************************
     * Bloom shading
     ********************************************************************************/

    /**
     * 'post1' pass: Perform (first) pass of post-processing
     */
    R.pass_post1.render = function(state) {
        // * Unbind any existing framebuffer (if there are no more passes)
        gl.bindFramebuffer(gl.FRAMEBUFFER, R.pass_post1.fbo);

        // * Clear the framebuffer depth to 1.0
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        // * Bind the postprocessing shader program
        gl.useProgram(R.progPost1.prog);

        // * Bind the deferred pass's color output as a texture input
        // Set gl.TEXTURE0 as the gl.activeTexture unit
        gl.activeTexture(gl.TEXTURE0);
        // Bind the TEXTURE_2D, R.pass_deferred.colorTex to the active texture unit
        gl.bindTexture(gl.TEXTURE_2D, R.pass_deferred.colorTex);
        // Configure the R.progPost1.u_color uniform to point at texture unit 0
        gl.uniform1i(R.progPost1.u_color, 0);

        gl.uniform2f(R.progPost1.u_screen_inv, 1.0/state.screenDim.w, 1.0/state.screenDim.h);

        // * Render a fullscreen quad to perform shading on
        renderFullScreenQuad(R.progPost1);
    };

    /**
     * 'post2' pass: Perform pass of post-processing
     */
    R.pass_post2.render = function(state) {
        // * Unbind any existing framebuffer (if there are no more passes)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // * Clear the framebuffer depth to 1.0
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        // * Bind the postprocessing shader program
        gl.useProgram(R.progPost2.prog);

        // * Bind the deferred pass's color output as a texture input
        // Set gl.TEXTURE0 as the gl.activeTexture unit
        gl.activeTexture(gl.TEXTURE0);
        // Bind the TEXTURE_2D, R.pass_deferred.colorTex to the active texture unit
        gl.bindTexture(gl.TEXTURE_2D, R.pass_deferred.colorTex);
        // Configure the R.progPost2.u_color uniform to point at texture unit 0
        gl.uniform1i(R.progPost2.o_color, 0);

        // * Bind the deferred pass's color output as a texture input
        // Set gl.TEXTURE0 as the gl.activeTexture unit
        gl.activeTexture(gl.TEXTURE1);
        // Bind the TEXTURE_2D, R.pass_deferred.colorTex to the active texture unit
        gl.bindTexture(gl.TEXTURE_2D, R.pass_post1.colorTex);
        // Configure the R.progPost2.u_color uniform to point at texture unit 0
        gl.uniform1i(R.progPost2.u_color, 1);

        gl.uniform2f(R.progPost2.u_screen_inv, 1.0/state.screenDim.w, 1.0/state.screenDim.h);

        // * Render a fullscreen quad to perform shading on
        renderFullScreenQuad(R.progPost2);
    };

    /********************************************************************************
     * Toon shading edge detector
     ********************************************************************************/

    /**
     * 'post1' pass: Perform (first) pass of post-processing
     */
    R.pass_postT1.render = function(state) {
        // * Unbind any existing framebuffer (if there are no more passes)
        gl.bindFramebuffer(gl.FRAMEBUFFER, R.pass_postT1.fbo);

        // * Clear the framebuffer depth to 1.0
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        // * Bind the postprocessing shader program
        gl.useProgram(R.progPostToon1.prog);

        // * Bind the deferred pass's color output as a texture input
        // Set gl.TEXTURE0 as the gl.activeTexture unit
        gl.activeTexture(gl.TEXTURE0);
        // Bind the TEXTURE_2D, R.pass_deferred.colorTex to the active texture unit
        gl.bindTexture(gl.TEXTURE_2D, R.pass_deferred.colorTex);
        // Configure the R.progPostToon1.u_color uniform to point at texture unit 0
        gl.uniform1i(R.progPostToon1.u_color, 0);

        gl.uniform2f(R.progPostToon1.u_screen_inv, 1.0/state.screenDim.w, 1.0/state.screenDim.h);

        // * Render a fullscreen quad to perform shading on
        renderFullScreenQuad(R.progPostToon1);
    };

    /**
     * 'post2' pass: Perform pass of post-processing
     */
    R.pass_postT2.render = function(state) {
        // * Unbind any existing framebuffer (if there are no more passes)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // * Clear the framebuffer depth to 1.0
        gl.clearDepth(1.0);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        // * Bind the postprocessing shader program
        gl.useProgram(R.progPostToon2.prog);

        // * Bind the deferred pass's color output as a texture input
        // Set gl.TEXTURE0 as the gl.activeTexture unit
        gl.activeTexture(gl.TEXTURE0);
        // Bind the TEXTURE_2D, R.pass_deferred.colorTex to the active texture unit
        gl.bindTexture(gl.TEXTURE_2D, R.pass_deferred.colorTex);
        // Configure the R.progPostToon2.u_color uniform to point at texture unit 0
        gl.uniform1i(R.progPostToon2.o_color, 0);

        // * Bind the deferred pass's color output as a texture input
        // Set gl.TEXTURE0 as the gl.activeTexture unit
        gl.activeTexture(gl.TEXTURE1);
        // Bind the TEXTURE_2D, R.pass_deferred.colorTex to the active texture unit
        gl.bindTexture(gl.TEXTURE_2D, R.pass_postT1.colorTex);
        // Configure the R.progPostToon2.u_color uniform to point at texture unit 0
        gl.uniform1i(R.progPostToon2.u_color, 1);

        gl.uniform2f(R.progPostToon2.u_screen_inv, 1.0/state.screenDim.w, 1.0/state.screenDim.h);

        // * Render a fullscreen quad to perform shading on
        renderFullScreenQuad(R.progPostToon2);
    };

    var renderFullScreenQuad = (function() {
        // The variables in this function are private to the implementation of
        // renderFullScreenQuad. They work like static local variables in C++.

        // Create an array of floats, where each set of 3 is a vertex position.
        // You can render in normalized device coordinates (NDC) so that the
        // vertex shader doesn't have to do any transformation; draw two
        // triangles which cover the screen over x = -1..1 and y = -1..1.
        // This array is set up to use gl.drawArrays with gl.TRIANGLE_STRIP.
        var positions = new Float32Array([
            -1.0, -1.0, 0.0,
             1.0, -1.0, 0.0,
            -1.0,  1.0, 0.0,
             1.0,  1.0, 0.0
        ]);

        var vbo = null;

        var init = function() {
            // Create a new buffer with gl.createBuffer, and save it as vbo.
            vbo = gl.createBuffer();

            // Bind the VBO as the gl.ARRAY_BUFFER
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            // Upload the positions array to the currently-bound array buffer
            // using gl.bufferData in static draw mode.
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        };

        return function(prog) {
            if (!vbo) {
                // If the vbo hasn't been initialized, initialize it.
                init();
            }

            // Bind the program to use to draw the quad
            gl.useProgram(prog.prog);

            // Bind the VBO as the gl.ARRAY_BUFFER
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            // Enable the bound buffer as the vertex attrib array for
            // prog.a_position, using gl.enableVertexAttribArray
            gl.enableVertexAttribArray(prog.a_position);
            // Use gl.vertexAttribPointer to tell WebGL the type/layout for
            // prog.a_position's access pattern.
            gl.vertexAttribPointer(prog.a_position, 3, gl.FLOAT, false, 0, 0);

            // Use gl.drawArrays (or gl.drawElements) to draw your quad.
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Unbind the array buffer.
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
        };
    })();
})();
